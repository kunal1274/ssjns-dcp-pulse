import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OutboundMail {
  to: string;
  subject: string;
  body: string;
}

export abstract class MailSender {
  abstract send(mail: OutboundMail): Promise<void>;
}

/**
 * Development transport: writes each message to a local outbox directory.
 * No external mail provider is configured for the synthetic demo.
 */
@Injectable()
export class FileMailSender extends MailSender {
  private readonly logger = new Logger(FileMailSender.name);
  constructor(private readonly dir: string) {
    super();
  }
  async send(mail: OutboundMail): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify(mail, null, 2), { mode: 0o600 });
    this.logger.log({ outboxFile: file }, 'Mail written to local outbox');
  }
}

export class NoopMailSender extends MailSender {
  async send(): Promise<void> {}
}

/** Test transport that keeps messages in memory. */
export class CapturingMailSender extends MailSender {
  readonly sent: OutboundMail[] = [];
  async send(mail: OutboundMail): Promise<void> {
    this.sent.push(mail);
  }
}
