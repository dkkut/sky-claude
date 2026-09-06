export interface DatabaseSchema {
  users: 'id | name | email | role | permissions | preferences | avatar | activity_log';
  tasks: 'id | title | description | status | priority | tags | due_date | owner_id | created_at | updated_at';
  finances: 'id | type | amount | category | note | month | created_at';
  analytics_data: 'id | metric | value | source | captured_at';
  notifications: 'id | title | body | priority | read | created_at';
  settings: 'id | user_id | theme | locale | security | integrations';
  ai_logs: 'id | context | suggestion | confidence | created_at';
  gamer_profiles: 'id | user_id | gamer_tag | level | xp | status | favorite_games';
  games: 'id | title | size | platform | status | version';
  game_library: 'id | user_id | game_id | installed | last_played';
  achievements: 'id | user_id | game_id | badge | xp_reward | unlocked_at';
  squads: 'id | name | owner_id | game_id | created_at';
  voice_rooms: 'id | squad_id | channel | active | started_at';
  bloom_posts: 'id | author_id | type | content | media | created_at';
  bloom_comments: 'id | post_id | author_id | content | created_at';
  bloom_likes: 'id | post_id | user_id | created_at';
  bloom_followers: 'id | follower_id | following_id | created_at';
  bloom_feed_cache: 'id | user_id | payload | updated_at';
  calls: 'id | type | chat_id | created_by | started_at | ended_at | status';
  call_participants: 'id | call_id | user_id | role | joined_at | left_at';
  screen_shares: 'id | call_id | user_id | fps | quality | started_at | ended_at';
  profile_privacy: 'id | user_id | can_message | can_call | show_online | show_stories | show_game_activity';
  stories: 'id | author_id | media_type | media_url | text | close_friends_only | expires_at | created_at';
  story_views: 'id | story_id | viewer_id | viewed_at';
  devices: 'id | user_id | device_name | platform | ip | last_active_at';
  sessions: 'id | user_id | device_id | token_hash | expires_at | created_at';
}

export const databaseTables: Array<keyof DatabaseSchema> = [
  'users',
  'tasks',
  'finances',
  'analytics_data',
  'notifications',
  'settings',
  'ai_logs',
  'gamer_profiles',
  'games',
  'game_library',
  'achievements',
  'squads',
  'voice_rooms',
  'bloom_posts',
  'bloom_comments',
  'bloom_likes',
  'bloom_followers',
  'bloom_feed_cache',
  'calls',
  'call_participants',
  'screen_shares',
  'profile_privacy',
  'stories',
  'story_views',
  'devices',
  'sessions',
];
