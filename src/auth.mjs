import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const publicUser=u=>({id:u.id,username:u.username,phone:u.phone||'',created_at:u.created_at});
async function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){
 const key=await scrypt(password,salt,64);return {salt,hash:key.toString('hex')};
}
async function passwordMatches(password,credentials){
 const candidate=await passwordHash(password,credentials.salt);
 return crypto.timingSafeEqual(Buffer.from(candidate.hash,'hex'),Buffer.from(credentials.hash,'hex'));
}
// Registration requires the invite code when REVIEW_INVITE_CODE is set; compared in constant time.
function inviteMatches(input,expected){
 const digest=v=>crypto.createHash('sha256').update(String(v)).digest();
 return typeof input==='string'&&crypto.timingSafeEqual(digest(input.trim()),digest(expected));
}
export function createAuth({repo,inviteCode=process.env.REVIEW_INVITE_CODE||''}){
 const ttl=7*24*60*60*1000,attempts=new Map();
 const cookie=(token,age)=>`review_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
 const getToken=req=>String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('review_session='))?.slice(15)||'';
 function throttle(req){
  const key=req.socket.remoteAddress,now=Date.now();
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  const item=attempts.get(key)||{count:0,until:now+15*60*1000};
  if(++item.count>25)throw fail(429,'尝试过于频繁，请 15 分钟后再试');attempts.set(key,item);
 }
 async function issueSession(user,res){
  const token=crypto.randomBytes(32).toString('hex');
  await repo.addSession(hashToken(token),user.id,Date.now()+ttl);
  res.setHeader('Set-Cookie',cookie(token,ttl/1000));return publicUser(user);
 }
 async function authenticate(req){
  const token=getToken(req);if(!token)return null;
  return repo.sessionUser(hashToken(token));
 }
 async function register(input,req,res){
  throttle(req);
  const {username,password,phone='',invite_code}=input||{};
  if(inviteCode&&!inviteMatches(invite_code,inviteCode))throw fail(403,'邀请码不正确，请向管理员索取');
  if(typeof username!=='string'||!/^[\p{L}\p{N}_-]{3,32}$/u.test(username))throw fail(400,'用户名须为 3–32 位文字、数字、下划线或短横线');
  if(typeof password!=='string'||password.length<8||password.length>128)throw fail(400,'密码须为 8–128 位');
  if(typeof phone!=='string'||(phone&&!/^\+?[\d -]{6,20}$/.test(phone)))throw fail(400,'请输入有效的联系电话，或留空');
  const credentials=await passwordHash(password);
  const user=await repo.createUser({id:crypto.randomUUID(),username,phone,credentials,created_at:new Date().toISOString()});
  return issueSession(user,res);
 }
 async function login(input,req,res){
  throttle(req);
  if(typeof input?.username!=='string'||typeof input?.password!=='string'||input.password.length>128)throw fail(400,'请输入用户名和密码');
  const user=await repo.userByName(input.username);
  if(!user||!await passwordMatches(input.password,user.credentials))throw fail(401,'用户名或密码错误');
  return issueSession(user,res);
 }
 async function logout(req,res){
  const hash=hashToken(getToken(req));await repo.deleteSession(hash);
  res.setHeader('Set-Cookie',cookie('',0));
 }
 async function changePassword(user,input,res){
  if(typeof input?.current_password!=='string'||input.current_password.length>128||!await passwordMatches(input.current_password,user.credentials))throw fail(400,'当前密码不正确');
  if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)throw fail(400,'新密码须为 8–128 位');
  const credentials=await passwordHash(input.password);
  await repo.changePassword(user.id,credentials);
  res.setHeader('Set-Cookie',cookie('',0));
 }
 return {authenticate,register,login,logout,changePassword};
}
