import { expect, test } from "@playwright/test";
const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000/api/v1";
test.describe("API smoke tests",()=>{
  test("health endpoint is available",async({request})=>{const response=await request.get(`${api}/health`);expect(response.ok()).toBeTruthy();expect(await response.json()).toMatchObject({status:"ok",service:"aurilink-api"});});
  test("protected endpoints reject anonymous access",async({request})=>{expect((await request.get(`${api}/sales/summary`)).status()).toBe(401);});
  test("admin can authenticate and read their profile",async({request})=>{const login=await request.post(`${api}/auth/login`,{data:{email:process.env.E2E_ADMIN_EMAIL??"admin@aurilink.local",password:process.env.E2E_ADMIN_PASSWORD??"ChangeMe123!"}});expect(login.ok()).toBeTruthy();const body=await login.json();expect(body.redirectTo).toBe("/admin");const profile=await request.get(`${api}/auth/me`,{headers:{Authorization:`Bearer ${body.accessToken}`}});expect(profile.ok()).toBeTruthy();expect((await profile.json()).roles).toContain("ADMIN");});
  test("browser session cookie authenticates without a bearer header",async({request})=>{const login=await request.post(`${api}/auth/login`,{data:{email:process.env.E2E_ADMIN_EMAIL??"admin@aurilink.local",password:process.env.E2E_ADMIN_PASSWORD??"ChangeMe123!"}});expect(login.ok()).toBeTruthy();const profile=await request.get(`${api}/auth/me`);expect(profile.ok()).toBeTruthy();expect((await profile.json()).roles).toContain("ADMIN");});
  test("password change requires the current password",async({request})=>{const login=await request.post(`${api}/auth/login`,{data:{email:process.env.E2E_ADMIN_EMAIL??"admin@aurilink.local",password:process.env.E2E_ADMIN_PASSWORD??"ChangeMe123!"}}),body=await login.json();const response=await request.patch(`${api}/users/me/password`,{headers:{Authorization:`Bearer ${body.accessToken}`},data:{currentPassword:"IncorrectPassword!",newPassword:"UnusedNewPassword!"}});expect(response.status()).toBe(403);});
  test("forgot password does not reveal account existence",async({request})=>{const response=await request.post(`${api}/auth/forgot-password`,{data:{email:"nonexistent-test@aurilink.invalid"}});expect(response.ok()).toBeTruthy();expect((await response.json()).message).toContain("If that email");});
});

test.describe("financial ledger integration",()=>{
  test.skip(process.env.E2E_ALLOW_WRITES!=="true","Runs only against a disposable test database");
  test("issuing and paying an invoice updates both ledgers exactly once",async({request})=>{
    const login=await request.post(`${api}/auth/login`,{data:{email:process.env.E2E_ADMIN_EMAIL??"admin@aurilink.local",password:process.env.E2E_ADMIN_PASSWORD??"ChangeMe123!"}}),session=await login.json(),headers={Authorization:`Bearer ${session.accessToken}`},key=Date.now();
    const financial=await request.post(`${api}/financial-accounts`,{headers,data:{name:`E2E Cash ${key}`,type:"CASH",openingBalance:0}});expect(financial.ok()).toBeTruthy();const financialAccount=await financial.json();
    const clientResponse=await request.post(`${api}/clients`,{headers,data:{name:`E2E Client ${key}`,email:`e2e-${key}@example.invalid`}});expect(clientResponse.ok()).toBeTruthy();const client=await clientResponse.json();
    const today=new Date(),due=new Date(today.getTime()+7*86400000),invoiceResponse=await request.post(`${api}/invoices`,{headers,data:{clientId:client.id,issueDate:today.toISOString(),dueDate:due.toISOString(),items:[{description:"Integration test service",unitPrice:1000,quantity:1,discount:0}],discount:0,tax:0}});expect(invoiceResponse.ok()).toBeTruthy();const invoice=await invoiceResponse.json();expect(invoice.status).toBe("DRAFT");
    let clients=await (await request.get(`${api}/clients`,{headers})).json();expect(Number(clients.find((value:{id:string})=>value.id===client.id).account.balance)).toBe(0);
    expect((await request.patch(`${api}/invoices/${invoice.id}/status`,{headers,data:{status:"SENT"}})).ok()).toBeTruthy();expect((await request.patch(`${api}/invoices/${invoice.id}/status`,{headers,data:{status:"SENT"}})).ok()).toBeTruthy();
    clients=await (await request.get(`${api}/clients`,{headers})).json();expect(Number(clients.find((value:{id:string})=>value.id===client.id).account.balance)).toBe(1000);
    const payment=await request.post(`${api}/invoices/${invoice.id}/payments`,{headers,data:{amount:400,paidAt:today.toISOString(),financialAccountId:financialAccount.id,method:"CASH",reference:`E2E-${key}`}});expect(payment.ok()).toBeTruthy();
    clients=await (await request.get(`${api}/clients`,{headers})).json();expect(Number(clients.find((value:{id:string})=>value.id===client.id).account.balance)).toBe(600);
    const accounts=await (await request.get(`${api}/financial-accounts`,{headers})).json();expect(Number(accounts.find((value:{id:string})=>value.id===financialAccount.id).balance)).toBe(400);
  });
});
