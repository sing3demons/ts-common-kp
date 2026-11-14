# @sing3demons/kp-logger

Request logger สำหรับ [`@sing3demons/kp`](../../README.md#logger): detail / summary log, correlation / request / trace id, mask ข้อมูล, เลือก format ได้ทั้ง JSON, logfmt และ text

```sh
npm install @sing3demons/kp @sing3demons/kp-logger
```

```ts
import '@sing3demons/kp-logger'          // ติดตั้งครั้งเดียว: เปิด app.logger() และ c.info() / c.addSummary() / ...
import { App } from '@sing3demons/kp'

const app = new App()
app.logger({ path: 'logger.yaml' })
app.get('/', (c) => c.info('hello').text('ok'))
```

ถ้าไม่ได้ import package นี้ `app.logger()` และ method ของ log บน `c` จะไม่มี (type error)

รายละเอียดทั้งหมด (config, detail / summary, dependency, mask, id) อยู่ที่หัวข้อ [Logger](../../README.md#logger) ใน README ของ repo
