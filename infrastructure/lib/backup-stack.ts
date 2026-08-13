import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as backup from "aws-cdk-lib/aws-backup";
import * as rds from "aws-cdk-lib/aws-rds";

interface BackupStackProps extends cdk.StackProps {
  database: rds.DatabaseInstance;
}

export class BackupStack extends cdk.Stack {
  public readonly backupVault: backup.BackupVault;
  public readonly backupPlan: backup.BackupPlan;

  constructor(scope: Construct, id: string, props: BackupStackProps) {
    super(scope, id, props);

    /*
     * Backup Vault
     */
    this.backupVault = new backup.BackupVault(this, "DatabaseBackupVault", {
      backupVaultName: "resilient-platform-backup-vault",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /*
     * Daily Backup Plan
     */
    this.backupPlan = new backup.BackupPlan(this, "DatabaseBackupPlan", {
      backupPlanName: "resilient-platform-daily-backup",
    });

    /*
     * Daily backup at 02:00 UTC
     */
    this.backupPlan.addRule(
      new backup.BackupPlanRule({
        ruleName: "DailyDatabaseBackup",
        backupVault: this.backupVault,

        scheduleExpression: cdk.aws_events.Schedule.cron({
          minute: "0",
          hour: "2",
        }),

        deleteAfter: cdk.Duration.days(7),
      }),
    );

    /*
     * Protect the RDS database
     *
     * Use the RDS instance ARN directly rather than
     * BackupResource.fromRdsDatabase(), which is not
     * available in the installed CDK API version.
     */
    this.backupPlan.addSelection("DatabaseBackupSelection", {
      resources: [backup.BackupResource.fromArn(props.database.instanceArn)],
    });

    /*
     * Outputs
     */
    new cdk.CfnOutput(this, "BackupVaultName", {
      value: this.backupVault.backupVaultName,
      description: "AWS Backup vault",
    });

    new cdk.CfnOutput(this, "BackupPlanName", {
      value: "resilient-platform-daily-backup",
      description: "AWS Backup plan",
    });

    new cdk.CfnOutput(this, "BackupSchedule", {
      value: "Daily at 02:00 UTC",
      description: "AWS Backup schedule",
    });

    new cdk.CfnOutput(this, "BackupRetention", {
      value: "7 days",
      description: "AWS Backup recovery point retention",
    });
  }
}
