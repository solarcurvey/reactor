data "aws_caller_identity" "current" {}
data "tls_certificate" "github" { url = "https://token.actions.githubusercontent.com" }

locals {
  state_bucket = "reactor-terraform-${data.aws_caller_identity.current.account_id}-${var.aws_region}"
  relay_role_pattern = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/reactor-*-managed-relay-*"
}

resource "aws_s3_bucket" "state" { bucket = local.state_bucket }
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = var.github_subjects
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "reactor-managed-relay-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid = "TerraformState"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }

  statement {
    sid = "ManagedRelayKms"
    actions = [
      "kms:CreateKey", "kms:CreateAlias", "kms:UpdateAlias", "kms:DeleteAlias",
      "kms:DescribeKey", "kms:GetKeyPolicy", "kms:PutKeyPolicy", "kms:ListResourceTags",
      "kms:TagResource", "kms:UntagResource", "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ManagedRelayIam"
    actions = [
      "iam:CreateRole", "iam:GetRole", "iam:DeleteRole", "iam:UpdateAssumeRolePolicy",
      "iam:PutRolePolicy", "iam:GetRolePolicy", "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy", "iam:DetachRolePolicy", "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies", "iam:TagRole", "iam:UntagRole", "iam:PassRole",
    ]
    resources = [local.relay_role_pattern]
  }

  statement {
    sid = "ManagedRelayLambda"
    actions = [
      "lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration",
      "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:DeleteFunction",
      "lambda:AddPermission", "lambda:RemovePermission", "lambda:ListVersionsByFunction",
      "lambda:TagResource", "lambda:UntagResource",
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:reactor-*-managed-relay-*"]
  }

  statement {
    sid = "ManagedRelayEventsLogsMetricsSecrets"
    actions = [
      "events:PutRule", "events:DeleteRule", "events:DescribeRule", "events:PutTargets", "events:RemoveTargets", "events:ListTargetsByRule", "events:TagResource", "events:UntagResource",
      "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:PutRetentionPolicy", "logs:ListTagsForResource", "logs:TagResource", "logs:UntagResource",
      "cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource",
      "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret", "secretsmanager:DescribeSecret", "secretsmanager:TagResource", "secretsmanager:UntagResource", "secretsmanager:GetResourcePolicy",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "reactor-managed-relay-terraform"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
