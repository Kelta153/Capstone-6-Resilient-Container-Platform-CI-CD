import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";

interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    /*
     * ECS Cluster
     */
    this.cluster = new ecs.Cluster(this, "ResilientPlatformCluster", {
      vpc: props.vpc,
      clusterName: "resilient-platform-cluster",
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    /*
     * ALB Security Group
     */
    const albSecurityGroup = new ec2.SecurityGroup(this, "AlbSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for the public Application Load Balancer",
      allowAllOutbound: true,
    });

    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      "Allow HTTP traffic from the internet",
    );

    /*
     * ECS Security Group
     */
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsSecurityGroup", {
      vpc: props.vpc,
      description: "Security group for ECS Fargate tasks",
      allowAllOutbound: true,
    });

    this.ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(3000),
      "Allow application traffic from the ALB",
    );

    /*
     * Application Load Balancer
     */
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      "ApplicationLoadBalancer",
      {
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        internetFacing: true,
        securityGroup: albSecurityGroup,
        loadBalancerName: "resilient-platform-alb",
      },
    );

    /*
     * Target Group
     *
     * Targets will be added when we create the ECS web service.
     */
    this.targetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "WebTargetGroup",
      {
        vpc: props.vpc,
        targetType: elbv2.TargetType.IP,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        healthCheck: {
          path: "/health",
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
      },
    );

    /*
     * ALB Listener
     */
    this.loadBalancer.addListener("HttpListener", {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup],
    });

    /*
     * Outputs
     */
    new cdk.CfnOutput(this, "EcsClusterName", {
      value: this.cluster.clusterName,
      description: "ECS cluster name",
    });

    new cdk.CfnOutput(this, "LoadBalancerDnsName", {
      value: this.loadBalancer.loadBalancerDnsName,
      description: "Application Load Balancer DNS name",
    });

    new cdk.CfnOutput(this, "TargetGroupArn", {
      value: this.targetGroup.targetGroupArn,
      description: "Web application target group ARN",
    });
  }
}
