import { createApp } from './app';

const PORT = Number(process.env.PORT ?? 3001);

const { app } = createApp({
  seed: process.env.MOCK_SEED ? Number(process.env.MOCK_SEED) : undefined,
  fixedNow: process.env.FIXED_DATE,
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
