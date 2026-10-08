-- Default requests go through the app server (encumbrances.requestDefault), which rate
-- limits them per client; nobody may call request_default directly.
revoke execute on function public.request_default(public.bytes32) from public, anon, authenticated;
