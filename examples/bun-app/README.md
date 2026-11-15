# Bun App Example

```
export GITHUB_TOKEN=$(gh auth token -u sing3demons)
docker build --secret id=github_token,env=GITHUB_TOKEN -t kp-bun-app .
docker run --rm --init -p 3000:3000 kp-bun-app
```