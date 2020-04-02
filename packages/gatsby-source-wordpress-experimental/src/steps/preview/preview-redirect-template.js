import { React, useEffect } from "react"
import { navigate } from "gatsby"

export default ({ location }) => {
  useEffect(() => {
    const url = new URL(location.href)
    const id = url.searchParams.get(`id`)

    const variables = {
      id,
    }

    const query = /* GraphQL */ `
      query REDIRECT($id: String!) {
        sitePage(context: { id: { eq: $id } }) {
          path
          context {
            id
          }
        }
      }
    `

    fetch(`/___graphql`, {
      method: `POST`,
      headers: { "Content-Type": `application/json` },
      body: JSON.stringify({ query, variables }),
    })
      .then(response => response.json())
      .then(json => {
        console.log(json)
        navigate(json.data.sitePage.path)
      })
  }, [])

  return <></>
}
