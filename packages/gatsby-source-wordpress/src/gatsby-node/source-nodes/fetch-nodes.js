import { createGatsbyNodesFromWPGQLContentNodes } from "./create-nodes"
import paginatedWpNodeFetch from "./paginated-wp-node-fetch"
import formatLogMessage from "../../utils/format-log-message"
import { CREATED_NODE_IDS } from "../constants"
import store from "../../store"

export const fetchWPGQLContentNodes = async (_, helpers, { url, verbose }) => {
  const { reporter } = helpers
  const contentNodeGroups = []

  const { queries } = store.getState().introspection

  await Promise.all(
    Object.entries(queries).map(
      ([fieldName, queryInfo]) =>
        new Promise(async resolve => {
          const { listQueryString, typeInfo } = queryInfo

          const activity = reporter.activityTimer(
            formatLogMessage(typeInfo.pluralName)
          )

          if (verbose) {
            activity.start()
          }

          const allNodesOfContentType = await paginatedWpNodeFetch({
            first: 100,
            after: null,
            contentTypePlural: typeInfo.pluralName,
            contentTypeSingular: typeInfo.singleName,
            nodeTypeName: typeInfo.nodesTypeName,
            url,
            query: listQueryString,
            activity,
            helpers,
          })

          if (verbose) {
            activity.end()
          }

          if (allNodesOfContentType && allNodesOfContentType.length) {
            contentNodeGroups.push({
              singular: fieldName,
              plural: fieldName,
              allNodesOfContentType,
            })
          }

          return resolve()
        })
    )
  )

  return contentNodeGroups
}

export const fetchAndCreateAllNodes = async (_, helpers, pluginOptions) => {
  const api = [helpers, pluginOptions]

  const { reporter, cache } = helpers

  let activity

  //
  // fetch nodes from WPGQL
  activity = reporter.activityTimer(formatLogMessage`fetch WordPress nodes`)
  activity.start()

  store.subscribe(state => {
    activity.setStatus(`fetched ${store.getState().logger.entityCount}`)
  })

  const wpgqlNodesByContentType = await fetchWPGQLContentNodes({}, ...api)

  activity.end()

  //
  // Create Gatsby nodes from WPGQL response
  activity = reporter.activityTimer(formatLogMessage`create nodes`)
  activity.start()

  const createdNodeIds = await createGatsbyNodesFromWPGQLContentNodes(
    {
      wpgqlNodesByContentType,
    },
    ...api
  )

  // save the node id's so we can touch them on the next build
  // so that we don't have to refetch all nodes
  await cache.set(CREATED_NODE_IDS, createdNodeIds)

  activity.end()
}
