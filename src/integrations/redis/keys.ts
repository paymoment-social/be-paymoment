const prefix = process.env.REDIS_NAMESPACE ?? "paymoment";

function segment(value: string) {
  return encodeURIComponent(value.trim().toLowerCase());
}

export const redisKeys = {
  idempotency: (scope: string, ownerId: string, key: string) => `${prefix}:idem:${segment(scope)}:${segment(ownerId)}:${segment(key)}`,
  rateLimit: (scope: string, identity: string, window: string) => `${prefix}:rate:${segment(scope)}:${segment(identity)}:${window}`,
  session: (tokenHash: string) => `${prefix}:session:${segment(tokenHash)}`,
  oauthState: (state: string) => `${prefix}:oauth:state:${segment(state)}`,
  oauthAuthorizationRequest: (requestId: string) => `${prefix}:oauth:authorization-request:${segment(requestId)}`,
  presence: (userId: string) => `${prefix}:presence:${segment(userId)}`,
  typing: (conversationId: string, userId: string) => `${prefix}:typing:${segment(conversationId)}:${segment(userId)}`,
  trending: (window: string) => `${prefix}:trending:${segment(window)}`,
  websocketChannel: (userId: string) => `${prefix}:ws:user:${segment(userId)}`,
  websocketPattern: () => `${prefix}:ws:user:*`,
  websocketBroadcastChannel: () => `${prefix}:ws:broadcast`,
};
