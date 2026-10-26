// Request body Kratos sends to the API's POST /internal/kratos/sms, which sends the one-time code
// through the SMS provider as an approved pattern (or only logs it in development).
function(ctx)
  local data = if 'template_data' in ctx && ctx.template_data != null then ctx.template_data else {};
  local codes = [std.toString(data[key]) for key in ['login_code', 'registration_code', 'verification_code', 'recovery_code'] if key in data && data[key] != null];
  {
    to: ctx.recipient,
    text: ctx.body,
    template: ctx.template_type,
    code: if std.length(codes) > 0 then codes[0] else null,
  }
