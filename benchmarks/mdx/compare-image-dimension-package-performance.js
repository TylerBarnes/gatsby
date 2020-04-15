const fs = require(`fs-extra`)
const probeSize = require(`probe-image-size`)
const imageSize = require(`image-size`)

function toArray(buf) {
  const arr = new Array(buf.length)

  for (let i = 0; i < buf.length; i++) {
    arr[i] = buf[i]
  }

  return arr
}

;(async () => {
  const imagePath = require.resolve(
    `./src/articles/largest-non-broken-image-article/not-broken.jpg`
    // `./src/articles/non-broken-image-article/not-broken.jpg`
    // `./src/articles/broken-image-article/broken.jpg`
  )

  const iterationMax = 100000

  const timesToRunTimers = 10
  let timesTimersRan = 0

  console.log(
    `comparing probe-image-size to image-size with ${iterationMax} calls to each`
  )

  while (timesTimersRan <= timesToRunTimers) {
    timesTimersRan++
    console.log(`Timer run ${timesTimersRan}`)
    let counter = 0

    console.time(`image-size`)
    while (counter <= iterationMax) {
      try {
        imageSize(imagePath)
      } catch (e) {
        // unlike probe-image-size, image-size throws errors for corrupt images
      }
      counter++
    }
    console.timeEnd(`image-size`)

    counter = 0

    console.time(`probe-image-size`)
    while (counter <= iterationMax) {
      probeSize.sync(toArray(fs.readFileSync(imagePath)))
      counter++
    }
    console.timeEnd(`probe-image-size`)
  }
})()
