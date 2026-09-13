locals {
  tags = {
    Project   = "REACTOR"
    Component = "managed-automation"
    ManagedBy = "terraform"
    Issue     = "83"
  }
  github_oidc_subject = var.github_oidc_subject != "" ? var.github_oidc_subject : "repo:${var.github_repository}:ref:refs/heads/main"
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "authorizer" {
  description             = "REACTOR MaintenanceJob authorizer"
  key_usage               = "SIGN_VERIFY"
  key_spec                = "ECC_SECG_P256K1"
  enable_key_rotation     = false
  deletion_window_in_days = 30
  tags                    = merge(local.tags, { Role = "maintenance-authorizer" })
}

resource "aws_kms_alias" "authorizer" {
  name          = "alias/${var.name_prefix}-maintenance-authorizer"
  target_key_id = aws_kms_key.authorizer.key_id
}

resource "aws_kms_key" "relay_a" {
  description             = "REACTOR managed relay A transaction signer"
  key_usage               = "SIGN_VERIFY"
  key_spec                = "ECC_SECG_P256K1"
  enable_key_rotation     = false
  deletion_window_in_days = 30
  tags                    = merge(local.tags, { Role = "relay-a" })
}

resource "aws_kms_alias" "relay_a" {
  name          = "alias/${var.name_prefix}-relay-a"
  target_key_id = aws_kms_key.relay_a.key_id
}

resource "aws_kms_key" "relay_b" {
  description             = "REACTOR managed relay B transaction signer"
  key_usage               = "SIGN_VERIFY"
  key_spec                = "ECC_SECG_P256K1"
  enable_key_rotation     = false
  deletion_window_in_days = 30
  tags                    = merge(local.tags, { Role = "relay-b" })
}

resource "aws_kms_alias" "relay_b" {
  name          = "alias/${var.name_prefix}-relay-b"
  target_key_id = aws_kms_key.relay_b.key_id
}

resource "aws_iam_role" "authorizer" {
  name = "${var.name_prefix}-maintenance-authorizer"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role" "relay_a" {
  name = "${var.name_prefix}-relay-a"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role" "relay_b" {
  name               = "${var.name_prefix}-relay-b"
  assume_role_policy = aws_iam_role.relay_a.assume_role_policy
  tags               = local.tags
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${var.name_prefix}-maintenance-authorizer"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "relay_a" {
  name              = "/aws/lambda/${var.name_prefix}-relay-a"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_cloudwatch_log_group" "relay_b" {
  name              = "/aws/lambda/${var.name_prefix}-relay-b"
  retention_in_days = 30
  tags              = local.tags
}

resource "aws_iam_role_policy" "authorizer" {
  name = "${var.name_prefix}-maintenance-authorizer-runtime"
  role = aws_iam_role.authorizer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AuthorizerKeyOnly"
        Effect   = "Allow"
        Action   = ["kms:Sign", "kms:GetPublicKey"]
        Resource = aws_kms_key.authorizer.arn
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.authorizer.arn}:*"
      },
      {
        Sid      = "Metrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = var.metric_namespace } }
      }
    ]
  })
}

resource "aws_iam_role_policy" "relay_a" {
  name = "${var.name_prefix}-relay-a-runtime"
  role = aws_iam_role.relay_a.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "OwnRelayKey"
        Effect   = "Allow"
        Action   = ["kms:Sign", "kms:GetPublicKey"]
        Resource = aws_kms_key.relay_a.arn
      },
      {
        Sid      = "ReadAuthorizerPublicKeyOnly"
        Effect   = "Allow"
        Action   = "kms:GetPublicKey"
        Resource = aws_kms_key.authorizer.arn
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.relay_a.arn}:*"
      },
      {
        Sid      = "Metrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = var.metric_namespace } }
      }
    ]
  })
}

resource "aws_iam_role_policy" "relay_b" {
  name = "${var.name_prefix}-relay-b-runtime"
  role = aws_iam_role.relay_b.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "OwnRelayKey"
        Effect   = "Allow"
        Action   = ["kms:Sign", "kms:GetPublicKey"]
        Resource = aws_kms_key.relay_b.arn
      },
      {
        Sid      = "ReadAuthorizerPublicKeyOnly"
        Effect   = "Allow"
        Action   = "kms:GetPublicKey"
        Resource = aws_kms_key.authorizer.arn
      },
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.relay_b.arn}:*"
      },
      {
        Sid      = "Metrics"
        Effect   = "Allow"
        Action   = "cloudwatch:PutMetricData"
        Resource = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = var.metric_namespace } }
      }
    ]
  })
}

resource "aws_lambda_function" "authorizer" {
  function_name                  = "${var.name_prefix}-maintenance-authorizer"
  role                           = aws_iam_role.authorizer.arn
  handler                        = "handler.handler"
  runtime                        = "nodejs22.x"
  filename                       = var.lambda_zip_path
  source_code_hash               = filebase64sha256(var.lambda_zip_path)
  memory_size                    = 256
  timeout                        = 25
  reserved_concurrent_executions = 1
  depends_on                     = [aws_cloudwatch_log_group.authorizer]
  environment {
    variables = {
      REACTOR_ENV                 = "PROD"
      REACTOR_ROLE                = "authorizer"
      REACTOR_CHAIN_ID            = tostring(var.chain_id)
      REACTOR_GATEWAY             = var.gateway_address
      REACTOR_KMS_KEY_ID          = aws_kms_key.authorizer.arn
      REACTOR_PLAN_URL            = var.plan_url
      REACTOR_SIGNED_JOB_SINK_URL = var.signed_job_sink_url
      REACTOR_METRIC_NAMESPACE    = var.metric_namespace
    }
  }
  tags = local.tags
}

resource "aws_lambda_function" "relay_a" {
  function_name                  = "${var.name_prefix}-relay-a"
  role                           = aws_iam_role.relay_a.arn
  handler                        = "handler.handler"
  runtime                        = "nodejs22.x"
  filename                       = var.lambda_zip_path
  source_code_hash               = filebase64sha256(var.lambda_zip_path)
  memory_size                    = 256
  timeout                        = 45
  reserved_concurrent_executions = 1
  depends_on                     = [aws_cloudwatch_log_group.relay_a]
  environment {
    variables = {
      REACTOR_ENV                   = "PROD"
      REACTOR_ROLE                  = "relay-a"
      REACTOR_CHAIN_ID              = tostring(var.chain_id)
      REACTOR_GATEWAY               = var.gateway_address
      REACTOR_RPC_URL               = var.rpc_url
      REACTOR_KMS_KEY_ID            = aws_kms_key.relay_a.arn
      REACTOR_JOB_SIGNER_KMS_KEY_ID = aws_kms_key.authorizer.arn
      REACTOR_SIGNED_JOB_SOURCE_URL = var.signed_job_source_url
      REACTOR_RELAY_DELAY_MS        = "0"
      REACTOR_RECEIPT_TIMEOUT_MS    = tostring(var.receipt_timeout_ms)
      REACTOR_METRIC_NAMESPACE      = var.metric_namespace
    }
  }
  tags = local.tags
}

resource "aws_lambda_function" "relay_b" {
  function_name                  = "${var.name_prefix}-relay-b"
  role                           = aws_iam_role.relay_b.arn
  handler                        = "handler.handler"
  runtime                        = "nodejs22.x"
  filename                       = var.lambda_zip_path
  source_code_hash               = filebase64sha256(var.lambda_zip_path)
  memory_size                    = 256
  timeout                        = 60
  reserved_concurrent_executions = 1
  depends_on                     = [aws_cloudwatch_log_group.relay_b]
  environment {
    variables = {
      REACTOR_ENV                   = "PROD"
      REACTOR_ROLE                  = "relay-b"
      REACTOR_CHAIN_ID              = tostring(var.chain_id)
      REACTOR_GATEWAY               = var.gateway_address
      REACTOR_RPC_URL               = var.rpc_url
      REACTOR_KMS_KEY_ID            = aws_kms_key.relay_b.arn
      REACTOR_JOB_SIGNER_KMS_KEY_ID = aws_kms_key.authorizer.arn
      REACTOR_SIGNED_JOB_SOURCE_URL = var.signed_job_source_url
      REACTOR_RELAY_DELAY_MS        = tostring(var.relay_b_delay_ms)
      REACTOR_RECEIPT_TIMEOUT_MS    = tostring(var.receipt_timeout_ms)
      REACTOR_METRIC_NAMESPACE      = var.metric_namespace
    }
  }
  tags = local.tags
}

resource "aws_lambda_function_event_invoke_config" "authorizer" {
  function_name                = aws_lambda_function.authorizer.function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}
resource "aws_lambda_function_event_invoke_config" "relay_a" {
  function_name                = aws_lambda_function.relay_a.function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}
resource "aws_lambda_function_event_invoke_config" "relay_b" {
  function_name                = aws_lambda_function.relay_b.function_name
  maximum_event_age_in_seconds = 60
  maximum_retry_attempts       = 0
}

resource "aws_cloudwatch_event_rule" "authorizer" {
  name                = "${var.name_prefix}-maintenance-authorizer"
  schedule_expression = "rate(1 minute)"
  tags                = local.tags
}
resource "aws_cloudwatch_event_target" "authorizer" {
  rule = aws_cloudwatch_event_rule.authorizer.name
  arn  = aws_lambda_function.authorizer.arn
}
resource "aws_lambda_permission" "authorizer_event" {
  statement_id  = "AllowEventBridgeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.authorizer.arn
}

resource "aws_cloudwatch_event_rule" "relay_a" {
  name                = "${var.name_prefix}-relay-a"
  schedule_expression = "rate(1 minute)"
  tags                = local.tags
}
resource "aws_cloudwatch_event_target" "relay_a" {
  rule = aws_cloudwatch_event_rule.relay_a.name
  arn  = aws_lambda_function.relay_a.arn
}
resource "aws_lambda_permission" "relay_a_event" {
  statement_id  = "AllowEventBridgeRelayA"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relay_a.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.relay_a.arn
}

resource "aws_cloudwatch_event_rule" "relay_b" {
  name                = "${var.name_prefix}-relay-b"
  schedule_expression = "rate(1 minute)"
  tags                = local.tags
}
resource "aws_cloudwatch_event_target" "relay_b" {
  rule = aws_cloudwatch_event_rule.relay_b.name
  arn  = aws_lambda_function.relay_b.arn
}
resource "aws_lambda_permission" "relay_b_event" {
  statement_id  = "AllowEventBridgeRelayB"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.relay_b.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.relay_b.arn
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = {
    authorizer = aws_lambda_function.authorizer.function_name
    relay_a    = aws_lambda_function.relay_a.function_name
    relay_b    = aws_lambda_function.relay_b.function_name
  }
  alarm_name          = "${var.name_prefix}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_action_arns
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "heartbeat_missing" {
  for_each = toset(["authorizer", "A", "B"])
  alarm_name          = "${var.name_prefix}-${lower(each.value)}-heartbeat-missing"
  namespace           = var.metric_namespace
  metric_name         = "Heartbeat"
  dimensions          = { Role = each.value == "authorizer" ? "authorizer" : each.value }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_action_arns
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "relay_low_balance" {
  for_each = toset(["A", "B"])
  alarm_name          = "${var.name_prefix}-relay-${lower(each.value)}-low-gas"
  namespace           = var.metric_namespace
  metric_name         = "RelayGasBalanceWei"
  dimensions          = { Role = each.value }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.low_relay_balance_wei
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_action_arns
  tags                = local.tags
}

# First apply is intentionally human-admin: it creates KMS keys, IAM roles and
# the OIDC provider. The GitHub role below is deliberately NOT a Terraform-admin
# role. It can only replace code on the three existing Lambda functions.
data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
  tags            = local.tags
}

resource "aws_iam_role" "github_deploy" {
  name = "${var.name_prefix}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.github_oidc_subject
        }
      }
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "${var.name_prefix}-lambda-code-deploy-only"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadFunctions"
        Effect = "Allow"
        Action = ["lambda:GetFunction", "lambda:GetFunctionConfiguration"]
        Resource = [
          aws_lambda_function.authorizer.arn,
          aws_lambda_function.relay_a.arn,
          aws_lambda_function.relay_b.arn
        ]
      },
      {
        Sid      = "ReplaceReviewedCodeOnly"
        Effect   = "Allow"
        Action   = "lambda:UpdateFunctionCode"
        Resource = [
          aws_lambda_function.authorizer.arn,
          aws_lambda_function.relay_a.arn,
          aws_lambda_function.relay_b.arn
        ]
      }
    ]
  })
}
