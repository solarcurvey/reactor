variable "aws_region" {
  type = string
}

variable "environment" {
  type = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod"
  }
}

variable "chain_id" {
  type = number
}

variable "gateway_address" {
  type    = string
  default = ""
}

variable "job_signer_address" {
  type    = string
  default = ""
}

variable "maintenance_api_base" {
  type = string
}

variable "relay_b_delay_ms" {
  type    = number
  default = 15000
}

variable "schedules_enabled" {
  type    = bool
  default = false
}

variable "schedule_expression" {
  type    = string
  default = "rate(1 minute)"
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "low_relay_balance" {
  type    = number
  default = 5
}

variable "forbidden_addresses" {
  description = "Comma-separated Guardian/launch/pricing/deployer addresses that relay keys must not reuse."
  type        = string
  default     = ""
}
