variable "aws_region" {
  type        = string
  description = "AWS region for KMS/Lambda/EventBridge."
  default     = "us-east-1"
}

variable "name_prefix" {
  type        = string
  description = "Resource name prefix."
  default     = "reactor-prod"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to bundle produced by scripts/build-aws-relay-bundle.sh."
}

variable "chain_id" {
  type        = number
  description = "Target Arc chain id. Do not point production automation at an unreviewed chain."
}

variable "gateway_address" {
  type        = string
  description = "Deployed AutomationGateway address."
}

variable "rpc_url" {
  type        = string
  description = "Primary Arc RPC URL used by managed relays."
}

variable "plan_url" {
  type        = string
  description = "Canonical REACTOR unsigned MaintenanceJob plan endpoint."
}

variable "signed_job_sink_url" {
  type        = string
  description = "Canonical endpoint that accepts KMS-signed job envelopes from the authorizer."
}

variable "signed_job_source_url" {
  type        = string
  description = "Canonical read endpoint returning the next signed job envelope to relays."
}

variable "relay_b_delay_ms" {
  type        = number
  description = "Relay B grace delay before checking usedJob and broadcasting."
  default     = 15000
}

variable "metric_namespace" {
  type    = string
  default = "REACTOR/Automation"
}

variable "low_relay_balance_wei" {
  type        = number
  description = "Alarm threshold for the Arc native gas balance on either relay address."
  default     = 1000000000000000000
}

variable "alarm_action_arns" {
  type        = list(string)
  description = "Optional SNS/incident action ARNs for CloudWatch alarms."
  default     = []
}

variable "github_repository" {
  type        = string
  description = "GitHub owner/repository allowed to assume the deployment role."
  default     = "solarcurvey/reactor"
}
