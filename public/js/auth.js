'use strict';
const form=document.querySelector('.auth-form');
const message=document.getElementById('auth-message');
form.addEventListener('submit',async event=>{
 event.preventDefault();
 const register=form.id==='register-form',button=form.querySelector('button[type="submit"]');
 const username=document.getElementById(register?'reg-username':'login-username').value.trim();
 const password=document.getElementById(register?'reg-password':'login-password').value;
 message.classList.add('hidden');
 if(register&&password!==document.getElementById('reg-confirm').value){message.textContent='两次输入的密码不一致';message.classList.remove('hidden');return;}
 button.disabled=true;
 try{
  const response=await fetch('/api/auth/'+(register?'register':'login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,...(register?{phone:document.getElementById('reg-phone').value.trim()}:{})})});
  const result=await response.json();if(!response.ok)throw Error(result.error||'提交失败');
  window.location.replace('/#dashboard');
 }catch(error){message.textContent=error.message;message.classList.remove('hidden');}
 finally{button.disabled=false;}
});
