import { describe, expect, it } from 'vitest'
import type { Db } from 'mongodb'
import { CONNECTORS } from '@lifekeel/workflows'
import { READ_ONLY_PROFILE_ACTIONS, profileReader } from '../profile-reader.js'
import { SUPPORTS_CHECK } from '../channel-profiles.js'

// The reader refuses before it ever reaches the executor, so the database is never queried.
const reader = profileReader({ collection: () => ({}) } as unknown as Db)

describe('profile reader', () => {
  it('refuses every action that could post, reply, delete or edit', async () => {
    const writes: [string, string][] = [
      ['twitter_x', 'createPosts'],
      ['twitter_x', 'createThread'],
      ['twitter_x', 'replyPost'],
      ['twitter_x', 'deletePosts'],
      ['twitter_x', 'likePost'],
      ['twitter_x', 'repostPost'],
      ['facebook_pages', 'create_post'],
      ['facebook_pages', 'create_photo_post'],
      ['instagram_business', 'create_post'],
      ['instagram_business', 'create_story'],
      ['threads', 'create_post'],
      ['linkedin', 'create_post'],
      ['gmail', 'send_email'],
    ]
    for (const [connector, action] of writes)
      await expect(reader('t1', connector, action, {}), `${connector}:${action}`).rejects.toThrow(
        /refused/,
      )
  })

  it('refuses a read action on a different connector, and an unknown connector', async () => {
    await expect(reader('t1', 'linkedin', 'getUsersMe', {})).rejects.toThrow(/refused/)
    await expect(reader('t1', 'twitter_x', 'get_profile', {})).rejects.toThrow(/refused/)
    await expect(reader('t1', 'made_up', 'get_profile', {})).rejects.toThrow(/refused/)
  })

  it('allows exactly one profile lookup per platform the console can read', () => {
    expect([...READ_ONLY_PROFILE_ACTIONS].sort()).toEqual([
      'facebook_pages:get_profile',
      'instagram_business:get_profile',
      'threads:get_profile',
      'twitter_x:getUsersMe',
    ])
    // Bluesky is read from its public endpoint; every other readable platform is on the list.
    expect(SUPPORTS_CHECK.size).toBe(READ_ONLY_PROFILE_ACTIONS.size + 1)
  })

  it('every allowed action is a GET in the connector registry', () => {
    for (const key of READ_ONLY_PROFILE_ACTIONS) {
      const [connector, action] = key.split(':')
      const def = CONNECTORS.find((c) => c.id === connector)?.actions.find((a) => a.id === action)
      expect(def, `${key} is defined`).toBeDefined()
      expect(def!.method, key).toBe('GET')
    }
  })
})
