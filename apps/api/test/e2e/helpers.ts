import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/config/env';
import { configureApp } from '../../src/configure-app';
import { CapturingMailSender, MailSender } from '../../src/mail/mail.service';

export const PASSWORD = () => {
  const p = process.env.SEED_DEMO_PASSWORD;
  if (!p) throw new Error('SEED_DEMO_PASSWORD is required for e2e tests');
  return p;
};

export async function createApp(): Promise<{ app: INestApplication; mail: CapturingMailSender }> {
  const mail = new CapturingMailSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailSender)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  return { app, mail };
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD(),
): Promise<Session> {
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.csrfToken as string };
}

export const tokenFrom = (body: string): string => {
  const m = /token=([A-Za-z0-9_-]+)/.exec(body);
  if (!m) throw new Error('no token in mail');
  return m[1];
};

export const unique = (prefix: string) =>
  `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.test`;
