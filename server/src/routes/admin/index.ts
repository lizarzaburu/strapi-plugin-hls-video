const permission = (action: 'read' | 'retry') => ({
  name: 'admin::hasPermissions',
  config: { actions: [`plugin::hls-video.${action}`] },
});

export default () => ({
  type: 'admin',
  routes: [
    {
      method: 'GET',
      path: '/jobs',
      handler: 'jobs.list',
      config: { policies: [permission('read')] },
    },
    {
      method: 'POST',
      path: '/jobs/:id/retry',
      handler: 'jobs.retry',
      config: { policies: [permission('retry')] },
    },
    {
      method: 'GET',
      path: '/status',
      handler: 'jobs.status',
      config: { policies: [permission('read')] },
    },
  ],
});
