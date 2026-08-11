import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as rds from "aws-cdk-lib/aws-rds";

interface ApplicationStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  cluster: ecs.Cluster;
  targetGroup: elbv2.ApplicationTargetGroup;
  ecsSecurityGroup: ec2.SecurityGroup;
  database: rds.DatabaseInstance;
  redisSecurityGroup: ec2.SecurityGroup;

  webImage: ecs.ContainerImage;
  workerImage: ecs.ContainerImage;

  redisEndpoint: string;
}

export class ApplicationStack extends cdk.Stack {
  public readonly queue: sqs.Queue;
  public readonly webServiceName: string;
  public readonly workerServiceName: string;

  constructor(scope: Construct, id: string, props: ApplicationStackProps) {
    super(scope, id, props);

    /*
     * SQS
     */
    this.queue = new sqs.Queue(this, "OrderQueue", {
      queueName: "resilient-platform-orders",
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
    });

    /*
     * Database access
     */
    props.database.connections.allowDefaultPortFrom(
      props.ecsSecurityGroup,
      "Allow ECS tasks to access PostgreSQL",
    );

    /*
     * Redis access
     */
    props.redisSecurityGroup.addIngressRule(
      props.ecsSecurityGroup,
      ec2.Port.tcp(6379),
      "Allow ECS tasks to access Redis",
    );

    /*
     * Web Task
     */
    const webTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "WebTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
      },
    );

    const webContainer = webTaskDefinition.addContainer("WebContainer", {
      image: props.webImage,

      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "web",
      }),

      environment: {
        PORT: "3000",
        AWS_REGION: cdk.Stack.of(this).region,

        DB_HOST: props.database.dbInstanceEndpointAddress,
        DB_PORT: "5432",
        DB_NAME: "ecommerce",

        REDIS_URL: `redis://${props.redisEndpoint}:6379`,

        SQS_QUEUE_URL: this.queue.queueUrl,
      },

      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(
          props.database.secret!,
          "username",
        ),

        DB_PASSWORD: ecs.Secret.fromSecretsManager(
          props.database.secret!,
          "password",
        ),
      },
    });

    webContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    /*
     * Allow ECS task to read RDS credentials
     */
    props.database.secret!.grantRead(webTaskDefinition.taskRole);

    /*
     * Web Service
     */
    const webService = new ecs.FargateService(this, "WebService", {
      cluster: props.cluster,
      taskDefinition: webTaskDefinition,
      desiredCount: 1,
      securityGroups: [props.ecsSecurityGroup],

      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },

      minHealthyPercent: 100,
      maxHealthyPercent: 200,

      circuitBreaker: {
        enable: true,
        rollback: true,
      },
    });

    this.webServiceName = webService.serviceName;

    props.targetGroup.addTarget(
      webService.loadBalancerTarget({
        containerName: "WebContainer",
        containerPort: 3000,
      }),
    );

    /*
     * Worker Task
     */
    const workerTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "WorkerTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
      },
    );

    workerTaskDefinition.addContainer("WorkerContainer", {
      image: props.workerImage,

      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "worker",
      }),

      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        SQS_QUEUE_URL: this.queue.queueUrl,
      },
    });

    /*
     * Worker Service
     */
    const workerService = new ecs.FargateService(this, "WorkerService", {
      cluster: props.cluster,
      taskDefinition: workerTaskDefinition,
      desiredCount: 1,
      securityGroups: [props.ecsSecurityGroup],

      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },

      minHealthyPercent: 100,
      maxHealthyPercent: 200,

      circuitBreaker: {
        enable: true,
        rollback: true,
      },
    });

    this.workerServiceName = workerService.serviceName;

    /*
     * SQS permissions
     */
    this.queue.grantSendMessages(webTaskDefinition.taskRole);

    this.queue.grantConsumeMessages(workerTaskDefinition.taskRole);

    /*
     * Outputs
     */
    new cdk.CfnOutput(this, "QueueUrl", {
      value: this.queue.queueUrl,
    });

    new cdk.CfnOutput(this, "WebServiceName", {
      value: this.webServiceName,
    });

    new cdk.CfnOutput(this, "WorkerServiceName", {
      value: this.workerServiceName,
    });
  }
}
