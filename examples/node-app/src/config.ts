export const config = {
  port: Number(process.env.PORT ?? 3000),
  apiPrefix: '/api',
} as const
