import store from "~/store"
import {
  getTypeSettingsByType,
  findTypeName,
} from "~/steps/create-schema-customization/helpers"
import { fieldIsExcludedOnParentType } from "~/steps/ingest-remote-schema/is-excluded"
import { returnAliasedFieldName } from "~/steps/create-schema-customization/transform-fields"

const transformInlineFragments = ({
  possibleTypes,
  gatsbyNodesInfo,
  typeMap,
  depth,
  maxDepth,
  parentType,
  parentField,
  fragments,
  circularQueryLimit,
  buildingFragment = false,
  ancestorTypeNames: parentAncestorTypeNames,
}) => {
  const ancestorTypeNames = [...parentAncestorTypeNames]

  return possibleTypes && depth <= maxDepth
    ? possibleTypes
        .map(possibleType => {
          possibleType = { ...possibleType }

          const type = typeMap.get(possibleType.name)

          if (!type) {
            return false
          }

          const typeSettings = getTypeSettingsByType(type)

          if (typeSettings.exclude) {
            return false
          }

          possibleType.type = { ...type }

          // save this type so we can use it in schema customization
          store.dispatch.remoteSchema.addFetchedType(type)

          const isAGatsbyNode = gatsbyNodesInfo.typeNames.includes(
            possibleType.name
          )

          if (isAGatsbyNode) {
            // we use the id to link to the top level Gatsby node
            possibleType.fields = [`id`]
            return possibleType
          }

          const typeInfo = typeMap.get(possibleType.name)

          let filteredFields = [...typeInfo.fields]

          if (parentType?.kind === `INTERFACE`) {
            // remove any fields from our fragment if the parent type already has them as shared fields
            filteredFields = filteredFields.filter(
              filteredField =>
                !parentType.fields.find(
                  parentField => parentField.name === filteredField.name
                )
            )
          }

          if (typeInfo) {
            const fields = recursivelyTransformFields({
              fields: filteredFields,
              parentType: type,
              depth,
              ancestorTypeNames,
              fragments,
              buildingFragment,
              circularQueryLimit,
            })

            if (!fields || !fields.length) {
              return false
            }

            possibleType.fields = [...fields]
            return possibleType
          }

          return false
        })
        .filter(Boolean)
    : null
}

// since we're counting circular types that may be on fields many levels up, incarnation felt like it works here ;) the types are born again in later generations
const countIncarnations = ({ typeName, ancestorTypeNames }) =>
  ancestorTypeNames.length
    ? ancestorTypeNames.filter(
        ancestorTypeName => ancestorTypeName === typeName
      )?.length
    : 0

function transformField({
  field,
  gatsbyNodesInfo,
  typeMap,
  maxDepth,
  depth,
  fieldBlacklist,
  fieldAliases,
  ancestorTypeNames: parentAncestorTypeNames,
  circularQueryLimit,
  fragments,
  buildingFragment,
} = {}) {
  const ancestorTypeNames = [...parentAncestorTypeNames]
  // we're potentially infinitely recursing when fields are connected to other types that have fields that are connections to other types
  //  so we need a maximum limit for that
  if (depth >= maxDepth) {
    return false
  }

  depth++

  // if the field has no type we can't use it.
  if (!field || !field.type) {
    return false
  }

  const typeSettings = getTypeSettingsByType(field.type)

  if (typeSettings.exclude || typeSettings.nodeInterface) {
    return false
  }

  // count the number of times this type has appeared as an ancestor of itself
  // somewhere up the tree
  const typeName = findTypeName(field.type)

  const typeIncarnationCount = countIncarnations({
    typeName,
    ancestorTypeNames,
  })

  if (typeIncarnationCount > 0) {
    // this type is nested within itself atleast once
    // create a fragment here that can be reused
    createFragment({
      fields: typeMap.get(typeName).fields,
      type: field.type,
      fragments,
      field,
      ancestorTypeNames: parentAncestorTypeNames,
      depth,
      fieldBlacklist,
      fieldAliases,
      typeMap,
      gatsbyNodesInfo,
      circularQueryLimit,
      queryDepth: maxDepth,
      buildingFragment,
    })
  }

  if (typeIncarnationCount >= circularQueryLimit) {
    return false
  }

  // this is used to alias fields that conflict with Gatsby node fields
  // for ex Gatsby and WPGQL both have a `parent` field
  const fieldName = returnAliasedFieldName({ fieldAliases, field })

  if (
    fieldBlacklist.includes(field.name) ||
    fieldBlacklist.includes(fieldName)
  ) {
    return false
  }

  // remove fields that have required args. They'll cause query errors if ommitted
  //  and we can't determine how to use those args programatically.
  if (
    field.args &&
    field.args.length &&
    field.args.find(arg => arg?.type?.kind === `NON_NULL`)
  ) {
    return false
  }

  const fieldType = field.type || {}
  const ofType = fieldType.ofType || {}

  if (
    fieldType.kind === `SCALAR` ||
    (fieldType.kind === `NON_NULL` && ofType.kind === `SCALAR`) ||
    (fieldType.kind === `LIST` && fieldType.ofType.kind === `SCALAR`)
  ) {
    return {
      fieldName,
      fieldType,
    }
  }

  const isListOfGatsbyNodes =
    ofType && gatsbyNodesInfo.typeNames.includes(typeName)

  const isListOfMediaItems = ofType && typeName === `MediaItem`

  if (fieldType.kind === `LIST` && isListOfGatsbyNodes && !isListOfMediaItems) {
    return {
      fieldName: fieldName,
      fields: [`id`],
      fieldType,
    }
  } else if (fieldType.kind === `LIST` && isListOfMediaItems) {
    return {
      fieldName: fieldName,
      fields: [`id`, `sourceUrl`],
      fieldType,
    }
  } else if (fieldType.kind === `LIST`) {
    const listOfType = typeMap.get(findTypeName(fieldType))

    const transformedFields = recursivelyTransformFields({
      fields: listOfType.fields,
      parentType: listOfType || fieldType,
      depth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    const transformedInlineFragments = transformInlineFragments({
      possibleTypes: listOfType.possibleTypes,
      parentType: listOfType || fieldType,
      parentField: field,
      gatsbyNodesInfo,
      typeMap,
      depth,
      maxDepth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
    })

    if (!transformedFields?.length && !transformedInlineFragments?.length) {
      return false
    }

    // if we have either inlineFragments or fields
    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments: transformedInlineFragments,
      fieldType,
    }
  }

  const isAGatsbyNode = gatsbyNodesInfo.typeNames.includes(typeName)
  const isAMediaItemNode = isAGatsbyNode && typeName === `MediaItem`

  // pull the id and sourceUrl for connections to media item gatsby nodes
  if (isAMediaItemNode) {
    return {
      fieldName: fieldName,
      fields: [`id`, `sourceUrl`],
      fieldType,
    }
  } else if (isAGatsbyNode) {
    // just pull the id for connections to other gatsby nodes
    return {
      fieldName: fieldName,
      fields: [`id`],
      fieldType,
    }
  }

  const typeInfo = typeMap.get(findTypeName(fieldType))

  const { fields } = typeInfo || {}

  let transformedInlineFragments

  if (typeInfo.possibleTypes) {
    transformedInlineFragments = transformInlineFragments({
      possibleTypes: typeInfo.possibleTypes,
      parentType: typeInfo,
      parentField: field,
      gatsbyNodesInfo,
      typeMap,
      depth,
      maxDepth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
    })
  }

  if (fields || transformedInlineFragments) {
    const transformedFields = recursivelyTransformFields({
      parentType: typeInfo,
      parentFieldName: field.name,
      fields,
      depth,
      ancestorTypeNames,
      parentField: field,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    if (!transformedFields?.length && !transformedInlineFragments?.length) {
      return false
    }

    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments: transformedInlineFragments,
      fieldType,
    }
  }

  if (fieldType.kind === `UNION`) {
    const typeInfo = typeMap.get(fieldType.name)

    const transformedFields = recursivelyTransformFields({
      fields: typeInfo.fields,
      parentType: fieldType,
      depth,
      ancestorTypeNames,
      fragments,
      circularQueryLimit,
      buildingFragment,
    })

    const inlineFragments = transformInlineFragments({
      possibleTypes: typeInfo.possibleTypes,
      gatsbyNodesInfo,
      typeMap,
      depth,
      maxDepth,
      ancestorTypeNames,
      parentField: field,
      fragments,
      circularQueryLimit,
    })

    return {
      fieldName: fieldName,
      fields: transformedFields,
      inlineFragments,
      fieldType,
    }
  }

  return false
}

const createFragment = ({
  fields,
  field,
  type,
  fragments,
  fieldBlacklist,
  fieldAliases,
  typeMap,
  gatsbyNodesInfo,
  queryDepth,
  ancestorTypeNames,
  buildingFragment = false,
}) => {
  const typeName = findTypeName(type)

  if (buildingFragment) {
    // this fragment is inside a fragment that's already being built so we should exit
    return null
  }

  const previouslyCreatedFragment = fragments?.[typeName]

  if (previouslyCreatedFragment && buildingFragment === typeName) {
    return previouslyCreatedFragment
  }

  const fragmentFields = fields.reduce((fragmentFields, field) => {
    const fieldTypeName = findTypeName(field.type)
    const fieldType = typeMap.get(fieldTypeName)

    if (
      // if this field is a different type than the fragment but has a field of the same type as the fragment,
      // we need to skip this field in the fragment to prevent nesting this type in itself a level down
      fieldType.name !== typeName &&
      fieldType?.fields?.find(
        innerFieldField => findTypeName(innerFieldField.type) === typeName
      )
    ) {
      return fragmentFields
    }

    const transformedField = transformField({
      field,
      gatsbyNodesInfo,
      typeMap,
      maxDepth: queryDepth,
      depth: 0,
      fieldBlacklist,
      fieldAliases,
      ancestorTypeNames,
      circularQueryLimit: 1,
      fragments,
      buildingFragment: typeName,
    })

    if (findTypeName(field.type) !== typeName && !!transformedField) {
      fragmentFields.push(transformedField)
    }

    return fragmentFields
  }, [])

  const queryType = typeMap.get(typeName)

  const transformedInlineFragments = queryType?.possibleTypes?.length
    ? transformInlineFragments({
        possibleTypes: queryType.possibleTypes,
        parentType: queryType,
        parentField: field,
        gatsbyNodesInfo,
        typeMap,
        depth: 0,
        maxDepth: queryDepth,
        circularQueryLimit: 1,
        ancestorTypeNames,
        fragments,
        buildingFragment: true,
      })
    : null

  if (fragments) {
    fragments[typeName] = {
      name: `${typeName}Fragment`,
      type: typeName,
      fields: fragmentFields,
      inlineFragments: transformedInlineFragments,
    }
  }

  return fragmentFields
}

const transformFields = ({
  fields,
  parentType,
  fragments,
  parentField,
  ancestorTypeNames,
  depth,
  fieldBlacklist,
  fieldAliases,
  typeMap,
  gatsbyNodesInfo,
  queryDepth,
  circularQueryLimit,
  pluginOptions,
  buildingFragment,
}) =>
  fields
    ?.filter(
      field =>
        !fieldIsExcludedOnParentType({
          pluginOptions,
          field,
          parentType,
          parentField,
        })
    )
    .map(field => {
      const transformedField = transformField({
        maxDepth: queryDepth,
        gatsbyNodesInfo,
        fieldBlacklist,
        fieldAliases,
        typeMap,
        field,
        depth,
        ancestorTypeNames,
        circularQueryLimit,
        fragments,
        buildingFragment,
      })

      if (transformedField) {
        // save this type so we know to use it in schema customization
        store.dispatch.remoteSchema.addFetchedType(field.type)
      }

      const typeName = findTypeName(field.type)
      const fragment = fragments?.[typeName]

      // @todo add any adjacent fields and inline fragments directly to the stored fragment object so this logic can be changed to if (fragment) useTheFragment()
      // once that's done it can be added above and below transformField() above ☝️
      // and potentially short circuit expensive work that will be thrown away anyway
      if (fragment && transformedField) {
        // if (fragment && buildingFragment !== typeName && transformedField) {
        // remove fields from this query that already exist in the fragment
        if (transformedField?.fields?.length) {
          transformedField.fields = transformedField.fields.filter(
            field =>
              !fragment.fields.find(
                fragmentField => fragmentField.fieldName === field.fieldName
              )
          )
        }

        // if this field has no fields (because it has inline fragments only)
        // we need to create an empty array since we treat reusable fragments as
        // a field
        if (!transformedField.fields) {
          transformedField.fields = []
        }

        transformedField.fields.push({
          internalType: `Fragment`,
          fragment,
        })

        if (transformedField?.inlineFragments?.length) {
          transformedField.inlineFragments = transformedField.inlineFragments.filter(
            fieldInlineFragment =>
              // yes this is a horrible use of .find(). @todo refactor this for better perf
              !fragment.inlineFragments.find(
                fragmentInlineFragment =>
                  fragmentInlineFragment.name === fieldInlineFragment.name
              )
          )
        }
      }

      if (field.fields && !transformedField) {
        return null
      }

      return transformedField
    })
    .filter(Boolean)

const recursivelyTransformFields = ({
  fields,
  parentType,
  fragments,
  parentField = {},
  ancestorTypeNames: parentAncestorTypeNames,
  depth = 0,
  buildingFragment = false,
}) => {
  if (!fields || !fields.length) {
    return null
  }

  if (!parentAncestorTypeNames) {
    parentAncestorTypeNames = []
  }

  const ancestorTypeNames = [...parentAncestorTypeNames]

  const {
    gatsbyApi: { pluginOptions },
    remoteSchema: { fieldBlacklist, fieldAliases, typeMap, gatsbyNodesInfo },
  } = store.getState()

  const {
    schema: { queryDepth, circularQueryLimit },
  } = pluginOptions

  if (depth >= queryDepth) {
    return null
  }

  const typeName = findTypeName(parentType)

  const grandParentTypeName = ancestorTypeNames.length
    ? ancestorTypeNames[ancestorTypeNames.length - 1]
    : null

  if (grandParentTypeName && typeName !== grandParentTypeName) {
    // if a field has fields of the same type as the field above it
    // we shouldn't fetch them. 2 types that are circular between each other
    // are dangerous as they will generate very large queries and fetch data we don't need
    // these types should instead be proper connections so we can identify
    // that only an id needs to be fetched.
    // @todo maybe move this into transformFields() instead of here
    fields = fields.filter(field => {
      const fieldTypeName = findTypeName(field.type)
      return fieldTypeName !== grandParentTypeName
    })
  }

  const typeIncarnationCount = countIncarnations({
    typeName,
    ancestorTypeNames,
  })

  // this appears to not be needed here but @todo investigate if that's always true
  // it's also being used in transformField()
  // if (typeIncarnationCount > 0) {
  //   // this type is nested within itself atleast once
  //   // create a fragment here that can be reused
  //   createFragment({
  //     fields,
  //     type: parentType,
  //     fragments,
  //     field: parentField,
  //     ancestorTypeNames: parentAncestorTypeNames,
  //     depth,
  //     fieldBlacklist,
  //     fieldAliases,
  //     typeMap,
  //     gatsbyNodesInfo,
  //     queryDepth,
  //     circularQueryLimit,
  //     pluginOptions,
  //     buildingFragment,
  //   })
  // }

  if (typeIncarnationCount >= circularQueryLimit) {
    return null
  }

  parentAncestorTypeNames.push(typeName)

  let recursivelyTransformedFields = transformFields({
    fields,
    parentType,
    fragments,
    parentField,
    ancestorTypeNames: parentAncestorTypeNames,
    depth,
    fieldBlacklist,
    fieldAliases,
    typeMap,
    gatsbyNodesInfo,
    queryDepth,
    circularQueryLimit,
    pluginOptions,
    buildingFragment,
  })

  if (!recursivelyTransformedFields.length) {
    return null
  }

  return recursivelyTransformedFields
}

export default recursivelyTransformFields
