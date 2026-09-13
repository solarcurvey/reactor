output "kms_key_ids" {
  value = { for k, v in aws_kms_key.runtime : k => v.key_id }
}

output "kms_key_arns" {
  value = { for k, v in aws_kms_key.runtime : k => v.arn }
}

output "lambda_functions" {
  value = { for k, v in aws_lambda_function.worker : k => v.function_name }
}

output "api_token_secret_arns" {
  value = { for k, v in aws_secretsmanager_secret.api_token : k => v.arn }
}

output "rpc_url_secret_arn" {
  value = aws_secretsmanager_secret.rpc_url.arn
}

output "schedules_enabled" {
  value = var.schedules_enabled
}

output "next_step" {
  value = var.schedules_enabled ? "Workers scheduled. Verify KMS EVM identities, relay funding, Gateway signer/keeper state and testnet evidence." : "Schedules are OFF. Populate the three role-scoped API-token secrets plus RPC secret, derive KMS EVM identities, set job_signer_address/gateway_address, fund relay addresses, then re-apply with schedules_enabled=true."
}
