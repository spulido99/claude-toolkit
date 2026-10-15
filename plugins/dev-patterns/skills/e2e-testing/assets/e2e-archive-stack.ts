// infra/lib/e2e-archive-stack.ts
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export class E2eArchiveStack extends Stack {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'E2eReports', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // The bucket is the durable record of what passed; deleting the stack must not delete it.
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        // The gate only needs recent commits.
        { expiration: Duration.days(365) },
      ],
    });

    new CfnOutput(this, 'E2eReportsBucketName', { value: this.bucket.bucketName });
  }
}
