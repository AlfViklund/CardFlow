import { Client as MinioClient } from 'minio';

export interface StorageConfig {
  endpoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export function createStorageClient(config: StorageConfig) {
  const client = new MinioClient({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });

  return {
    client,
    bucket: config.bucket,
    async ensureBucket() {
      const exists = await client.bucketExists(config.bucket);
      if (!exists) {
        await client.makeBucket(config.bucket, 'us-east-1');
      }
    },
    async putObject(options: {
      key: string;
      content: Buffer;
      contentType: string;
    }) {
      await client.putObject(config.bucket, options.key, options.content, options.content.length, {
        'Content-Type': options.contentType,
      });
    },
    async statObject(key: string) {
      return client.statObject(config.bucket, key);
    },
    async getObject(key: string) {
      return client.getObject(config.bucket, key);
    },
  };
}
