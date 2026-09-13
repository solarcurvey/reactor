# Defense in depth: the GitHub OIDC deployment role must never control or
# invoke the maintenance-authorizer Lambda. Updating that function's code would
# indirectly grant use of its KMS signing permission even without kms:Sign on
# the GitHub role itself. Authorizer code/config changes stay on the human-
# reviewed Terraform/admin path.
resource "aws_iam_role_policy" "github_authorizer_explicit_deny" {
  name = "${var.name_prefix}-deny-authorizer-control"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "NeverControlMaintenanceAuthorizer"
      Effect   = "Deny"
      Action   = "lambda:*"
      Resource = aws_lambda_function.authorizer.arn
    }]
  })
}
