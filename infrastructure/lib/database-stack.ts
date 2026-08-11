import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as elasticache from "aws-cdk-lib/aws-elasticache";

interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly redisSecurityGroup: ec2.SecurityGroup;
  public readonly redisEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    /*
     * Database Security Group
     */
    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        vpc: props.vpc,
        description: "Security group for RDS PostgreSQL",
        allowAllOutbound: true,
      },
    );

    /*
     * RDS PostgreSQL Multi-AZ
     */
    this.database = new rds.DatabaseInstance(this, "PostgresDatabase", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),

      databaseName: "ecommerce",

      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO,
      ),

      allocatedStorage: 20,

      storageType: rds.StorageType.GP3,

      vpc: props.vpc,

      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },

      multiAz: true,

      securityGroups: [databaseSecurityGroup],

      credentials: rds.Credentials.fromGeneratedSecret("dbadmin"),

      backupRetention: cdk.Duration.days(7),

      deletionProtection: false,

      removalPolicy: cdk.RemovalPolicy.DESTROY,

      publiclyAccessible: false,

      storageEncrypted: true,
    });

    /*
     * Redis Security Group
     */
    this.redisSecurityGroup = new ec2.SecurityGroup(
      this,
      "RedisSecurityGroup",
      {
        vpc: props.vpc,
        description: "Security group for ElastiCache Redis",
        allowAllOutbound: true,
      },
    );

    /*
     * Redis Subnet Group
     */
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      "RedisSubnetGroup",
      {
        description: "Private subnet group for Redis",
        subnetIds: props.vpc.privateSubnets.map((subnet) => subnet.subnetId),
      },
    );

    /*
     * Redis Cluster
     */
    const redis = new elasticache.CfnCacheCluster(this, "RedisCluster", {
      engine: "redis",
      cacheNodeType: "cache.t3.micro",
      numCacheNodes: 1,
      clusterName: "resilient-platform-redis",
      vpcSecurityGroupIds: [this.redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
    });

    redis.addDependency(redisSubnetGroup);

    /*
     * Expose Redis endpoint to ApplicationStack
     */
    this.redisEndpoint = redis.attrRedisEndpointAddress;

    /*
     * Database outputs
     */
    new cdk.CfnOutput(this, "DatabaseEndpoint", {
      value: this.database.dbInstanceEndpointAddress,
    });

    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: this.database.secret!.secretArn,
    });

    new cdk.CfnOutput(this, "RedisEndpoint", {
      value: redis.attrRedisEndpointAddress,
    });

    new cdk.CfnOutput(this, "RedisPort", {
      value: redis.attrRedisEndpointPort,
    });
  }
}
