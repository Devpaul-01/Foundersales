Bullmq instance 

Potential Interview Questions You'll Get

Q: What happens if Redis connection drops mid-job?
A: BullMQ pauses, ioredis retries indefinitely (maxRetriesPerRequest: null), job resumes when connection returns.

Q: Is rejectUnauthorized: false a security risk?
A: Yes — it allows MITM attacks. For sensitive apps, you'd download the actual CA cert and use ca: [cert] instead. But Upstash doesn't provide one easily.

Q: Why not use connection pooling?
A: BullMQ internally manages concurrency; multiple BullMQ connections to same Redis can cause race conditions. Share one connection via this exported instance.

Q: How would you test this connection is working?
A: await bullmqConnection.ping() — should return 'PONG'.

One-line summary for interview

"Temperature controls randomness in token selection — 0.7 balances creativity and determinism by slightly flattening the probability distribution, making responses varied but still coherent."