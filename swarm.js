import createDB from './db.js'
import createBee from './bee.js'
import { createHash } from 'crypto'
import { validateEvent, isPersistent } from './nostr_events.js'

const prefix = 'hyper-nostr-'

export default async function createSwarm (sdk, _topic) {
  const topic = prefix + _topic
  const subscriptions = new Map()

  const bee = await createBee(sdk, topic)
  const { handleEvent, queryEvents } = await createDB(bee)

  const knownDBs = new Set()
  knownDBs.add(bee.autobase.localInput.url)

  const discovery = await sdk.get(createTopicBuffer(topic))
  const events = discovery.registerExtension(topic, {
    encoding: 'json',
    onmessage: streamEvent
  })
  const DBBroadcast = discovery.registerExtension(topic + '-sync', {
    encoding: 'json',
    onmessage: async (message) => {
      let sawNew = false
      for (const url of message) {
        if (knownDBs.has(url)) continue
        sawNew = true
        await handleNewDB(url)
      }
      if (sawNew) broadcastDBs()
    }
  })
  discovery.on('peer-add', initConnection)
  discovery.on('peer-remove', logPeers)
  initConnection()

  console.log(`swarm ${topic} created with hyper!`)
  return { subscriptions, sendEvent, queryEvents, sendQueryToSubscription }

  function initConnection () {
    logPeers()
    broadcastDBs()
  }

  function logPeers () {
    console.log(`${discovery.peers.length} peers on ${_topic}!`)
  }

  function streamEvent (event) {
    subscriptions.forEach((sub, key) => {
      if (validateEvent(event, sub.filters)) sendEventTo(event, sub, key)
    })
  }

  function sendEvent (event) {
    events.broadcast(event)
    streamEvent(event)
    if (isPersistent(event)) handleEvent(event)
  }

  function broadcastDBs () {
    DBBroadcast.broadcast(Array.from(knownDBs))
  }

  async function handleNewDB (url) {
    knownDBs.add(url)
    console.log('DB count:', knownDBs.size)
    await bee.autobase.addInput(await sdk.get(url))
    subscriptions.forEach((sub, key) => sendQueryToSubscription(sub, key, { hasLimit: false }))
  }

  async function sendQueryToSubscription (sub, key, { hasLimit } = { hasLimit: true }) {
    return queryEvents(sub.filters, { hasLimit }).then(events =>
      events.forEach(event => sendEventTo(event, sub, key))
    )
  }
}

function sendEventTo (event, sub, key) {
  if (!sub.receivedEvents.has(event.id)) {
    sub.socket.send(`["EVENT", "${key}", ${JSON.stringify((delete event._id, event))}]`)
    sub.receivedEvents.add(event.id)
  }
}

function createTopicBuffer (topic) {
  return createHash('sha256').update(topic).digest()
}
