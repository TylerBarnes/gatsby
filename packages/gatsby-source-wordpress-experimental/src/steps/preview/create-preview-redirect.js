const atob = require(`atob`)

const createPreviewRedirect = async ({ actions, page, getNode }) => {
  if (process.env.NODE_ENV !== `development`) {
    return
  }

  if (!process.env.ENABLE_GATSBY_REFRESH_ENDPOINT) {
    return
  }

  actions.createPage({
    path: `/___wp-preview/`,
    component: require.resolve(`./preview-redirect-template.js`),
  })

  // if (!page.context || !page.context.id) {
  //   return
  // }

  // const decodedId = atob(page.context.id)

  // if (!decodedId.includes(`:`)) {
  //   return
  // }

  // const pathFromId = decodedId.replace(`:`, `/`)

  // const fromPath = `/___wp-preview/${pathFromId}/`

  // actions.createRedirect({
  //   fromPath,
  //   toPath: page.path,
  //   redirectInBrowser: true,
  // })
}

export { createPreviewRedirect }
