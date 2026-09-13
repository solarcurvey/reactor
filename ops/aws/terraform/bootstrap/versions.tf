terraform {
  required_version = ">= 1.9.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 6.0, < 7.0" }
    tls = { source = "hashicorp/tls", version = ">= 4.0, < 5.0" }
  }
}

provider "aws" { region = var.aws_region }

variable "aws_region" { type = string }
variable "github_subjects" {
  description = "Exact GitHub OIDC sub claims allowed to assume the deploy role. Keep this restricted to protected GitHub Environments."
  type        = list(string)
  default = [
    "repo:solarcurvey/reactor:environment:reactor-staging",
    "repo:solarcurvey/reactor:environment:reactor-prod",
  ]
}
