output "github_deploy_role_arn" { value = aws_iam_role.github_deploy.arn }
output "terraform_state_bucket" { value = aws_s3_bucket.state.bucket }
output "aws_region" { value = var.aws_region }
