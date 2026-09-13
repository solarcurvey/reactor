output "maintenance_authorizer_kms_arn" { value = aws_kms_key.authorizer.arn }
output "relay_a_kms_arn" { value = aws_kms_key.relay_a.arn }
output "relay_b_kms_arn" { value = aws_kms_key.relay_b.arn }
output "authorizer_function" { value = aws_lambda_function.authorizer.function_name }
output "relay_a_function" { value = aws_lambda_function.relay_a.function_name }
output "relay_b_function" { value = aws_lambda_function.relay_b.function_name }
output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
