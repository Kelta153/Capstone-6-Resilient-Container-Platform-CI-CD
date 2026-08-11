#!/usr/bin/env node

import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";

import { NetworkStack } from "../lib/network-stack";
import { ComputeStack } from "../lib/compute-stack";
import { DatabaseStack } from "../lib/database-stack";
import { ApplicationStack } from "../lib/application-stack";
import { PipelineStack } from "../lib/pipeline-stack";

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const networkStack = new NetworkStack(app, "NetworkStack", {
  env,
});

const computeStack = new ComputeStack(app, "ComputeStack", {
  env,
  vpc: networkStack.vpc,
});

const databaseStack = new DatabaseStack(app, "DatabaseStack", {
  env,
  vpc: networkStack.vpc,
});

/*
 * Existing ECR repositories
 */
const webRepository = ecr.Repository.fromRepositoryName(
  computeStack,
  "WebRepository",
  "resilient-platform-web",
);

const workerRepository = ecr.Repository.fromRepositoryName(
  computeStack,
  "WorkerRepository",
  "resilient-platform-worker",
);

/*
 * Application Stack
 */
const applicationStack = new ApplicationStack(app, "ApplicationStack", {
  env,

  vpc: networkStack.vpc,

  cluster: computeStack.cluster,

  targetGroup: computeStack.targetGroup,

  ecsSecurityGroup: computeStack.ecsSecurityGroup,

  database: databaseStack.database,

  redisSecurityGroup: databaseStack.redisSecurityGroup,

  webImage: ecs.ContainerImage.fromEcrRepository(webRepository, "latest"),

  workerImage: ecs.ContainerImage.fromEcrRepository(workerRepository, "latest"),

  redisEndpoint: databaseStack.redisEndpoint,
});

/*
 * CI/CD Pipeline
 */
new PipelineStack(app, "PipelineStack", {
  env,

  cluster: computeStack.cluster,

  webServiceName: applicationStack.webServiceName,

  workerServiceName: applicationStack.workerServiceName,

  webRepository,

  workerRepository,
});
