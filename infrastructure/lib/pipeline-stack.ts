import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";

interface PipelineStackProps extends cdk.StackProps {
  cluster: ecs.Cluster;

  webServiceName: string;
  workerServiceName: string;

  webRepository: ecr.IRepository;
  workerRepository: ecr.IRepository;
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    /*
     * GitHub CodeConnections configuration
     */
    const githubConnectionArn = process.env.GITHUB_CONNECTION_ARN;

    const githubOwner = process.env.GITHUB_OWNER;

    const githubRepository = process.env.GITHUB_REPOSITORY;

    const githubBranch = process.env.GITHUB_BRANCH || "main";

    if (!githubConnectionArn || !githubOwner || !githubRepository) {
      throw new Error(
        "Missing required GitHub environment variables: " +
          "GITHUB_CONNECTION_ARN, GITHUB_OWNER, GITHUB_REPOSITORY",
      );
    }

    /*
     * CodeBuild
     */
    const buildProject = new codebuild.PipelineProject(this, "BuildProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,

        computeType: codebuild.ComputeType.SMALL,

        privileged: true,
      },

      environmentVariables: {
        AWS_ACCOUNT_ID: {
          value: cdk.Stack.of(this).account,
        },

        AWS_DEFAULT_REGION: {
          value: cdk.Stack.of(this).region,
        },

        WEB_REPOSITORY_URI: {
          value: props.webRepository.repositoryUri,
        },

        WORKER_REPOSITORY_URI: {
          value: props.workerRepository.repositoryUri,
        },

        ECS_CLUSTER: {
          value: props.cluster.clusterName,
        },

        WEB_SERVICE: {
          value: props.webServiceName,
        },

        WORKER_SERVICE: {
          value: props.workerServiceName,
        },
      },
    });

    /*
     * ECR permissions
     */
    props.webRepository.grantPullPush(buildProject);

    props.workerRepository.grantPullPush(buildProject);

    /*
     * ECS deployment permissions
     */
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,

        actions: [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:UpdateService",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
        ],

        resources: ["*"],
      }),
    );

    /*
     * Pipeline artifacts
     */
    const sourceOutput = new codepipeline.Artifact("SourceArtifact");

    const buildOutput = new codepipeline.Artifact("BuildArtifact");

    /*
     * CodePipeline
     */
    const pipeline = new codepipeline.Pipeline(this, "Pipeline", {
      pipelineName: "resilient-platform-pipeline",

      restartExecutionOnUpdate: true,
    });

    /*
     * Source stage
     */
    pipeline.addStage({
      stageName: "Source",

      actions: [
        new codepipeline_actions.CodeStarConnectionsSourceAction({
          actionName: "GitHubSource",

          owner: githubOwner,

          repo: githubRepository,

          branch: githubBranch,

          connectionArn: githubConnectionArn,

          output: sourceOutput,

          triggerOnPush: true,
        }),
      ],
    });

    /*
     * Build stage
     */
    pipeline.addStage({
      stageName: "Build",

      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "BuildAndPush",

          project: buildProject,

          input: sourceOutput,

          outputs: [buildOutput],
        }),
      ],
    });

    /*
     * Outputs
     */
    new cdk.CfnOutput(this, "PipelineName", {
      value: pipeline.pipelineName,
    });

    new cdk.CfnOutput(this, "GitHubConnectionArn", {
      value: githubConnectionArn,
    });
  }
}
