locals {
  roles = {
    authorizer = { handler = "authorizerHandler", timeout = 30 }
    relay-a    = { handler = "relayAHandler", timeout = 55 }
    relay-b    = { handler = "relayBHandler", timeout = 55 }
  }
  metric_roles = {
    authorizer = "authorizer"
    relay-a    = "relay-A"
    relay-b    = "relay-B"
  }
  name = "reactor-${var.environment}-managed-relay"
}

data "archive_file" "worker" {
  type        = "zip"
  source_file = "${path.module}/../../dist/worker.mjs"
  output_path = "${path.module}/../../dist/worker.zip"
}

resource "aws_kms_key" "runtime" {
  for_each                 = local.roles
  description              = "REACTOR ${var.environment} ${each.key} secp256k1 signing key"
  key_usage                = "SIGN_VERIFY"
  customer_master_key_spec = "ECC_SECG_P256K1"
  enable_key_rotation      = false
  deletion_window_in_days  = 30
}

resource "aws_kms_alias" "runtime" {
  for_each      = local.roles
  name          = "alias/reactor-${var.environment}-${each.key}"
  target_key_id = aws_kms_key.runtime[each.key].key_id
}

resource "aws_secretsmanager_secret" "maintenance_api_token" {
  name                    = "reactor/${var.environment}/managed-relay/api-token"
  recovery_window_in_days = 30
  description             = "Bearer token for REACTOR canonical maintenance job API. Value is set out-of-band; never commit it."
}

resource "aws_secretsmanager_secret" "rpc_url" {
  name                    = "reactor/${var.environment}/managed-relay/rpc-url"
  recovery_window_in_days = 30
  description             = "Arc RPC URL for REACTOR managed relay. Value is set out-of-band; never commit provider credentials."
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runtime" {
  for_each           = local.roles
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "basic_logs" {
  for_each   = local.roles
  role       = aws_iam_role.runtime[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "runtime" {
  for_each = local.roles

  statement {
    sid       = "OwnKmsKeyOnly"
    actions   = ["kms:GetPublicKey", "kms:Sign", "kms:DescribeKey"]
    resources = [aws_kms_key.runtime[each.key].arn]
  }

  statement {
    sid       = "ReadRuntimeSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.maintenance_api_token.arn, aws_secretsmanager_secret.rpc_url.arn]
  }
}

resource "aws_iam_role_policy" "runtime" {
  for_each = local.roles
  name     = "${local.name}-${each.key}"
  role     = aws_iam_role.runtime[each.key].id
  policy   = data.aws_iam_policy_document.runtime[each.key].json
}

resource "aws_cloudwatch_log_group" "worker" {
  for_each          = local.roles
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "worker" {
  for_each = local.roles

  function_name = "${local.name}-${each.key}"
  role          = aws_iam_role.runtime[each.key].arn
  runtime       = "nodejs22.x"
  handler       = "worker.${each.value.handler}"
  filename      = data.archive_file.worker.output_path
  source_code_hash = data.archive_file.worker.output_base64sha256
  timeout       = each.value.timeout
  memory_size   = 256
  reserved_concurrent_executions = 1

  environment {
    variables = {
      REACTOR_ENV                       = var.environment == "prod" ? "PROD" : "STAGING"
      MAINTENANCE_CHAIN_ID              = tostring(var.chain_id)
      MAINTENANCE_GATEWAY_ADDRESS       = var.gateway_address
      MAINTENANCE_JOB_SIGNER_ADDRESS    = var.job_signer_address
      MAINTENANCE_API_BASE              = var.maintenance_api_base
      MAINTENANCE_API_TOKEN_SECRET_ID   = aws_secretsmanager_secret.maintenance_api_token.arn
      MAINTENANCE_RPC_URL_SECRET_ID     = aws_secretsmanager_secret.rpc_url.arn
      MAINTENANCE_KMS_KEY_ID            = aws_kms_key.runtime["authorizer"].key_id
      RELAY_A_KMS_KEY_ID                = aws_kms_key.runtime["relay-a"].key_id
      RELAY_B_KMS_KEY_ID                = aws_kms_key.runtime["relay-b"].key_id
      RELAY_B_DELAY_MS                  = tostring(var.relay_b_delay_ms)
      MAINTENANCE_FORBIDDEN_ADDRESSES   = var.forbidden_addresses
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]
}

resource "aws_cloudwatch_event_rule" "schedule" {
  for_each            = var.schedules_enabled ? local.roles : {}
  name                = "${local.name}-${each.key}"
  description         = "REACTOR ${each.key} managed-maintenance tick"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "schedule" {
  for_each  = var.schedules_enabled ? local.roles : {}
  rule      = aws_cloudwatch_event_rule.schedule[each.key].name
  target_id = each.key
  arn       = aws_lambda_function.worker[each.key].arn
}

resource "aws_lambda_permission" "events" {
  for_each      = var.schedules_enabled ? local.roles : {}
  statement_id  = "AllowEventBridge-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule[each.key].arn
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = local.roles
  alarm_name          = "${local.name}-${each.key}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.worker[each.key].function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "heartbeat" {
  for_each            = var.schedules_enabled ? local.roles : {}
  alarm_name          = "${local.name}-${each.key}-heartbeat-missing"
  namespace           = "REACTOR/ManagedRelay"
  metric_name         = "Heartbeat"
  dimensions          = { Role = local.metric_roles[each.key] }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}

resource "aws_cloudwatch_metric_alarm" "relay_balance" {
  for_each            = var.schedules_enabled ? toset(["relay-a", "relay-b"]) : toset([])
  alarm_name          = "${local.name}-${each.key}-low-gas-balance"
  namespace           = "REACTOR/ManagedRelay"
  metric_name         = "RelayGasBalance"
  dimensions          = { Role = local.metric_roles[each.key] }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = var.low_relay_balance
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}
