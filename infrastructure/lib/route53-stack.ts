import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

interface Route53StackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  loadBalancer: elbv2.ApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
}

export class Route53Stack extends cdk.Stack {
  public readonly hostedZone: route53.IHostedZone;

  constructor(scope: Construct, id: string, props: Route53StackProps) {
    super(scope, id, props);

    /*
     * Private Route 53 Hosted Zone
     */
    this.hostedZone = new route53.PrivateHostedZone(this, "PrivateHostedZone", {
      zoneName: "resilient.local",
      vpc: props.vpc,
      comment: "Private DNS zone for resilient platform disaster recovery",
    });

    /*
     * CloudWatch Alarm
     *
     * Monitors the ECS web target group.
     * Alarm enters ALARM state when at least one
     * target is unhealthy for two consecutive periods.
     */
    const unhealthyHostAlarm = new cloudwatch.Alarm(
      this,
      "ALBUnhealthyHostAlarm",
      {
        alarmDescription:
          "Triggers when the ECS web target group has unhealthy targets",

        metric: new cloudwatch.Metric({
          namespace: "AWS/ApplicationELB",
          metricName: "UnHealthyHostCount",

          dimensionsMap: {
            LoadBalancer: props.loadBalancer.loadBalancerFullName,
            TargetGroup: props.targetGroup.targetGroupFullName,
          },

          statistic: "Maximum",
          period: cdk.Duration.minutes(1),
        }),

        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,

        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      },
    );

    /*
     * Route 53 Health Check
     *
     * Route 53 evaluates the CloudWatch alarm instead
     * of attempting to reach the private ALB directly.
     */
    const albHealthCheck = new route53.CfnHealthCheck(this, "ALBHealthCheck", {
      healthCheckConfig: {
        type: "CLOUDWATCH_METRIC",

        alarmIdentifier: {
          name: unhealthyHostAlarm.alarmName,
          region: this.region,
        },

        insufficientDataHealthStatus: "LastKnownStatus",
      },

      healthCheckTags: [
        {
          key: "Name",
          value: "resilient-platform-alb-health-check",
        },
      ],
    });

    /*
     * S3 Disaster Recovery Page
     *
     * Static website used as the secondary/failover
     * destination.
     */
    const errorPageBucket = new s3.Bucket(this, "ErrorPageBucket", {
      bucketName: `resilient-platform-dr-error-${this.account}`,

      websiteIndexDocument: "index.html",
      websiteErrorDocument: "index.html",

      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),

      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    /*
     * Static DR page
     */
    new s3deploy.BucketDeployment(this, "ErrorPageDeployment", {
      sources: [
        s3deploy.Source.data(
          "index.html",
          `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Service Temporarily Unavailable</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      text-align: center;
      margin-top: 15%;
    }

    h1 {
      font-size: 2.5rem;
    }

    p {
      font-size: 1.2rem;
    }
  </style>
</head>
<body>
  <h1>Service Temporarily Unavailable</h1>
  <p>
    The primary application environment is currently unavailable.
  </p>
  <p>
    Disaster recovery procedures are in progress.
  </p>
</body>
</html>`,
        ),
      ],
      destinationBucket: errorPageBucket,
    });

    /*
     * S3 Website Access
     */
    errorPageBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [new cdk.aws_iam.AnyPrincipal()],
        actions: ["s3:GetObject"],
        resources: [errorPageBucket.arnForObjects("*")],
      }),
    );

    /*
     * Primary DNS record
     *
     * Points internal application traffic toward
     * the ALB while the Route 53 health check is healthy.
     */
    new route53.CfnRecordSet(this, "PrimaryRecord", {
      hostedZoneId: this.hostedZone.hostedZoneId,
      name: `app.${this.hostedZone.zoneName}`,
      type: "A",

      setIdentifier: "primary",
      failover: "PRIMARY",

      healthCheckId: albHealthCheck.ref,

      aliasTarget: {
        dnsName: props.loadBalancer.loadBalancerDnsName,
        hostedZoneId: props.loadBalancer.loadBalancerCanonicalHostedZoneId,
        evaluateTargetHealth: true,
      },
    });

    /*
     * Secondary DNS record
     *
     * Used when the primary Route 53 health check
     * reports that the application is unhealthy.
     */
    new route53.CfnRecordSet(this, "SecondaryRecord", {
      hostedZoneId: this.hostedZone.hostedZoneId,
      name: `app.${this.hostedZone.zoneName}`,
      type: "A",

      setIdentifier: "secondary",
      failover: "SECONDARY",

      aliasTarget: {
        dnsName: errorPageBucket.bucketWebsiteDomainName,
        hostedZoneId: "Z3AQBSTGFYJSTF",
        evaluateTargetHealth: false,
      },
    });

    /*
     * Outputs
     */
    new cdk.CfnOutput(this, "HostedZoneId", {
      value: this.hostedZone.hostedZoneId,
      description: "Route 53 private hosted zone ID",
    });

    new cdk.CfnOutput(this, "HostedZoneName", {
      value: this.hostedZone.zoneName,
      description: "Route 53 private hosted zone name",
    });

    new cdk.CfnOutput(this, "HealthCheckId", {
      value: albHealthCheck.ref,
      description: "Route 53 CloudWatch health check ID",
    });

    new cdk.CfnOutput(this, "HealthAlarmName", {
      value: unhealthyHostAlarm.alarmName,
      description: "CloudWatch alarm used by Route 53 health check",
    });

    new cdk.CfnOutput(this, "ErrorPageBucketName", {
      value: errorPageBucket.bucketName,
      description: "S3 disaster recovery error page bucket",
    });

    new cdk.CfnOutput(this, "ErrorPageWebsiteUrl", {
      value: errorPageBucket.bucketWebsiteUrl,
      description: "S3 disaster recovery website URL",
    });

    new cdk.CfnOutput(this, "ApplicationDnsName", {
      value: `app.${this.hostedZone.zoneName}`,
      description: "Internal application DNS name",
    });
  }
}
