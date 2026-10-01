import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function customerEnglishName(name){
  return name;
}
const app = express();
app.use(cors());
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PARTNER_WA = String(process.env.PARTNER_WHATSAPP || '96171127840').replace(/\D/g,'');
const OWNER_WA = String(process.env.OWNER_WHATSAPP || '').replace(/\D/g,'');
const DATA_DIR = path.join(__dirname,'data');
const DATA_FILE = path.join(DATA_DIR,'ghf-data.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE,JSON.stringify({customers:[],orders:[],privileges:[]},null,2));

function db(){
 const d=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));

 if(!d.privileges) d.privileges=[];
 if(!d.reviews) d.reviews=[];
 if(!d.customerReviews) d.customerReviews=[];

 return d;
}

function save(d){
 fs.writeFileSync(DATA_FILE,JSON.stringify(d,null,2));
}
function id(prefix){return prefix+'-'+crypto.randomBytes(5).toString('hex').toUpperCase();}
function phone(v){return String(v||'').replace(/\D/g,'').replace(/^00/,'');}
function money(n){return Math.round(Number(n||0)*100)/100;}
function waUrl(to,text){return `https://wa.me/${phone(to)}?text=${encodeURIComponent(text)}`;}
function orderText(order,includeActions=false){
 if(includeActions){
   return [
     'GOLDEN HONEY FUSION',
     '',
     'السيد محمد،',
     '',
     'لديك طلب جديد.',
     '',
     'صاحب الطلب: '+order.customer.name,
'رقم الطلب: '+(order.orderNumber||order.id),
     '',
     'GHF'
   ].join('\n');
 }

 const l=[
   'GHF NEW ORDER',
   '',
   'ORDER: '+order.id,
   '',
   'CUSTOMER: '+order.customer.name,
   'PHONE: '+order.customer.phone,
   'ADDRESS: '+order.customer.province+' - '+order.customer.city,
   order.customer.address
 ];

 if(order.customer.floor) l.push('FLOOR: '+order.customer.floor);
 if(order.customer.notes) l.push('NOTES: '+order.customer.notes);

 l.push(
   '',
   'ITEMS'
 );

 order.items.forEach((i,index)=>{
   l.push(
     (index+1)+'. '+i.product,
     '   '+(i.weight||'—')+' × '+(i.qty||1)+' | $'+money(i.lineTotal).toFixed(2)
   );
 });

 l.push(
   '',
   'SUBTOTAL: $'+money(order.subtotal).toFixed(2)
 );

 if(order.discountAmount){
   l.push('PRIVILEGE: -$'+money(order.discountAmount).toFixed(2));
 }

 l.push(
   'DELIVERY: $'+money(order.deliveryFee).toFixed(2),
   'TOTAL: $'+money(order.total).toFixed(2),
   '',
   'STATUS: '+order.status
 );

 return l.join('\n');
}
function makePrivilegeCode(d){const used=new Set(d.customers.map(x=>String(x.privilegeCode||'')));let code='';do{code=String(100000+crypto.randomInt(0,900000));}while(used.has(code));return code;}
function customerFor(d,c){
 const p=phone(c.phone);let x=d.customers.find(v=>v.phone===p);
 if(!x)x={id:id('GHF-C'),phone:p,name:c.name,privilegeCode:makePrivilegeCode(d),purchases:0,consecutivePurchases:0,benefitRate:0,benefitBalance:0,benefitExpiresAt:null,benefitUsedOrderId:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 if(!d.customers.includes(x))d.customers.push(x);
 if(!x.privilegeCode)x.privilegeCode=makePrivilegeCode(d);
 if(typeof x.purchases!=='number')x.purchases=0;if(typeof x.consecutivePurchases!=='number')x.consecutivePurchases=x.purchases;if(typeof x.benefitBalance!=='number')x.benefitBalance=0;
 x.name=c.name;x.updatedAt=new Date().toISOString();return x;
}
function computeBenefit(customer,baseAmount){
 const rate=customer.consecutivePurchases>=7?0.05:customer.consecutivePurchases>=4?0.04:0.033;

 const newAmount=money(Number(baseAmount||0)*rate);
 const oldAmount=Number(customer.benefitBalance||0);

 return {
  rate,
  amount:money(oldAmount+newAmount),
  expiresAt:new Date(Date.now()+45*86400000).toISOString()
 };
}
function activeBenefit(customer){if(!customer||!customer.benefitBalance||!customer.benefitExpiresAt)return null;if(new Date(customer.benefitExpiresAt).getTime()<=Date.now()){customer.benefitBalance=0;customer.benefitRate=0;customer.benefitExpiresAt=null;customer.benefitUsedOrderId=null;return null;}if(customer.benefitUsedOrderId)return null;return {code:String(customer.privilegeCode||''),amount:money(customer.benefitBalance),rate:Number(customer.benefitRate)||0,expiresAt:customer.benefitExpiresAt};}
function addBenefit(customer,amount){
 amount=money(amount);
 if(amount<=0)return;

 const now=Date.now();
 const expires=customer.benefitExpiresAt
   ? new Date(customer.benefitExpiresAt).getTime()
   : 0;

 if(!customer.benefitBalance || !expires || expires<=now){
   customer.benefitBalance=amount;
   customer.benefitExpiresAt=new Date(now+45*86400000).toISOString();
 }else{
   customer.benefitBalance=money(Number(customer.benefitBalance||0)+amount);
 }

 customer.benefitUsedOrderId=null;
}
app.get('/api/privileges/check',(req,res)=>{
try{

const d=db();

const phoneNumber=phone(req.query.phone);
const code=String(req.query.code||'').trim();

const c=d.customers.find(x=>
x.phone===phoneNumber &&
String(x.privilegeCode)===code
);

if(!c)
return res.status(400).json({ok:false,error:'Invalid privilege code'});

const benefit=activeBenefit(c);

if(!benefit)
return res.status(400).json({ok:false,error:'Privilege expired or already used'});

res.json({
ok:true,
valid:true,
amount:benefit.amount,
rate:benefit.rate,
expiresAt:benefit.expiresAt,
code:benefit.code
});

}catch(e){
console.error(e);
res.status(500).json({error:'Privilege check failed'});
}
});
async function sendCloud(to,text){const token=process.env.WHATSAPP_ACCESS_TOKEN,pn=process.env.WHATSAPP_PHONE_NUMBER_ID;if(!token||!pn||!to)return {sent:false,reason:'WhatsApp Cloud API not configured'};const r=await fetch(`https://graph.facebook.com/v23.0/${pn}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone(to),type:'text',text:{preview_url:true,body:text}})});const j=await r.json();if(!r.ok)throw new Error(JSON.stringify(j));return {sent:true,response:j};}

app.get('/health',(req,res)=>res.json({ok:true,service:'GHF backend',time:new Date().toISOString()}));
app.use(express.static(path.join(__dirname,'public')));
app.get('/admin',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','admin.html'));
});
const ADMIN_USERNAME = "GHF198486";
const ADMIN_PASSWORD = "GHM198486";
const adminSessions = new Map();

function adminAuth(req,res,next)
{
   next();
}
app.post('/api/admin/login',(req,res)=>{
 const username=String(req.body?.username||'');
 const password=String(req.body?.password||'');

 if(username!==ADMIN_USERNAME || password!==ADMIN_PASSWORD){
   return res.status(401).json({error:"Invalid admin login"});
 }

 const token=crypto.randomBytes(32).toString('hex');

 adminSessions.set(token,{
   expiresAt:Date.now()+24*60*60*1000
 });

 res.json({ok:true,token});
});


app.get('/api/admin/orders',(req,res)=>{
 try{
   const d=db();
   const orders=[...d.orders].sort(
    (a,b)=>new Date(b.createdAt)-new Date(a.createdAt)
   );

   res.json({ok:true,orders});

 }catch(e){
   res.status(500).json({error:"Cannot load admin orders"});
 }
});
app.post('/api/orders',async(req,res)=>{ console.log("NEW ORDER RECEIVED", req.body);try{const b=req.body||{},c=b.customer||{},items=Array.isArray(b.items)?b.items:[];if(!c.name||!c.phone||!c.province||!c.city||!c.address||!items.length)return res.status(400).json({error:'Missing required order fields'});const d=db();
c.phone=phone(c.phone);
const customer=customerFor(d,c);const subtotal=money(b.subtotal),deliveryFee=money(b.deliveryFee||5),submittedCode=String(b.discountCode||'').trim();let discountAmount=0;if(submittedCode){if(submittedCode!==String(customer.privilegeCode||''))return res.status(400).json({error:'Invalid privilege code'});const benefit=activeBenefit(customer);if(!benefit)return res.status(400).json({error:'Privilege expired or already used'});discountAmount=Math.min(benefit.amount,subtotal);}const discountedSubtotal=money(Math.max(0,subtotal-discountAmount)),total=money(discountedSubtotal+deliveryFee);const orderNumber='GHF-'+String((d.orders||[]).length+1).padStart(4,'0');
const order={id:id('GHF-O'),orderNumber,customerId:customer.id,customer:{...c,phone:phone(c.phone)},items,subtotal,discountCode:submittedCode||null,discountAmount,discountedSubtotal,deliveryFee,total,status:'NEW',createdAt:new Date().toISOString(),confirmedAt:null,shippedAt:null,deliveredAt:null,confirmToken:crypto.randomBytes(18).toString('hex'),shipToken:crypto.randomBytes(18).toString('hex')};
 customer.benefitUsedOrderId=order.id;
 customer.benefitBalance=0;
 customer.benefitRate=0;
 customer.benefitExpiresAt=null;
order.confirmUrl=`${BASE_URL}/api/orders/${order.id}/confirm?token=${order.confirmToken}`;order.shipUrl=`${BASE_URL}/api/orders/${order.id}/ship?token=${order.shipToken}`;d.orders.push(order);save(d);const partnerText=orderText(order,true),partnerWhatsAppUrl=waUrl(PARTNER_WA,partnerText);let partnerApi={sent:false};if(process.env.WHATSAPP_ACCESS_TOKEN&&process.env.WHATSAPP_PHONE_NUMBER_ID)partnerApi=await sendCloud(PARTNER_WA,partnerText);res.json({ok:true,orderId:order.id,customerId:customer.id,orderUrl:`${BASE_URL}/api/orders/${order.id}`,partnerWhatsAppUrl,partnerApi});}catch(e){console.error(e);res.status(500).json({error:'Could not create order'});}});

app.get('/api/orders',(req,res)=>{
  try{
    const d=db();

    res.json({
      orders:d.orders || [],
      privileges:d.privileges || []
    });

  }catch(e){
    res.status(500).json({error:'Cannot load orders'});
  }
});

app.get('/api/orders/:id',(req,res)=>{
  const d=db();
  const o=d.orders.find(x=>x.id===req.params.id);
  if(!o)return res.status(404).send('Order not found');
  res.type('html').send(orderHtml(o));
});
app.get('/api/customer/:id',(req,res)=>{
try{

const d=db();

const customer=d.customers.find(
c=>c.id===req.params.id
);

if(!customer)
return res.status(404).json({error:"Customer not found"});


const orders=(d.orders||[]).filter(o=>
o.customerId===customer.id &&
["CONFIRMED","SHIPPED","DELIVERED"].includes(o.status)
);


const totalPurchases=money(
orders.reduce((sum,o)=>sum+Number(o.total||0),0)
);


let level="BRONZE MEMBER";
let stars=1;

if(totalPurchases>=200){
level="GOLD MEMBER";
stars=3;
}
else if(totalPurchases>=100){
level="SILVER MEMBER";
stars=2;
}


res.json({
ok:true,
name:customer.name,
customerId:customer.id,
orders:orders.length,
totalPurchases,
level,
stars,
benefitBalance:customer.benefitBalance||0
});

}catch(e){
console.error(e);
res.status(500).json({error:"Customer load failed"});
}
});
app.get('/api/orders/:id/confirm', async (req,res)=>{
  try {
    const d=db();
    const o=d.orders.find(x=>x.id===req.params.id);

    if(!o || req.query.token!==o.confirmToken){
      return res.status(403).send('Invalid confirmation link');
    }

    if(o.status==='NEW'){
      o.status='CONFIRMED';
      o.confirmedAt=new Date().toISOString();

      const c=d.customers.find(x=>x.id===o.customerId);

      if(c){
        
      }

      save(d);
    }

    res.type('html').send(actionHtml('ORDER CONFIRMED',o,[]));

  } catch(e) {
    console.error(e);
    res.status(500).send('Confirmation failed');
  }
});
app.get('/api/review/:id',(req,res)=>{
  const d=db();

  const o=d.orders.find(x=>x.id===req.params.id);

  if(!o){
    return res.status(404).json({error:'Order not found'});
  }

  res.json({
    ok:true,
    orderId:o.id,
    customerId:o.customerId,
    items:o.items.map(i=>({
      product:i.product
    }))
  });

});
app.post('/api/review/submit',async(req,res)=>{
try{

const d=db();

const review=req.body;

if(!review.orderId){
return res.status(400).json({
error:'Missing order id'
});
}

if(!d.customerReviews){
d.customerReviews=[];
}

if(d.customerReviews.some(r=>r.orderId===review.orderId)){
return res.status(400).json({
error:'Review already submitted'
});
}


const order=d.orders.find(
o=>o.id===review.orderId
);


if(!order){
return res.status(404).json({
error:'Order not found'
});
}


d.customerReviews.push({

orderId:order.id,

customerId:order.customerId,

customer:order.customer?.name||'',

phone:order.customer?.phone||'',

products:review.products||[],

brandRating:review.brandRating||0,

deliveryRating:review.deliveryRating||0,

comment:review.comment||'',

createdAt:new Date().toISOString()

});


const customer=d.customers.find(
c=>c.id===order.customerId
);


if(customer){
addBenefit(customer,0.50);
}


save(d);


res.json({
ok:true
});


}catch(e){

console.error(e);

res.status(500).json({
error:'Could not save review'
});

}

});
const PARTNER_USERNAME=String(process.env.PARTNER_USERNAME||'partner');
const PARTNER_PASSWORD=String(process.env.PARTNER_PASSWORD||'CHANGE-ME');
const partnerSessions=new Map();
function partnerAuth(req,res,next){const h=String(req.headers.authorization||''),token=h.startsWith('Bearer ')?h.slice(7).trim():'';const s=partnerSessions.get(token);if(!s||s.expiresAt<Date.now()){if(token)partnerSessions.delete(token);return res.status(401).json({error:'Partner authentication required'});}next();}
app.post('/api/partner/login',(req,res)=>{const username=String(req.body?.username||''),password=String(req.body?.password||'');if(username!==PARTNER_USERNAME||password!==PARTNER_PASSWORD)return res.status(401).json({error:'Invalid partner credentials'});const token=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+12*60*60*1000;partnerSessions.set(token,{createdAt:Date.now(),expiresAt});res.json({ok:true,token,expiresAt:new Date(expiresAt).toISOString()});});
app.post('/api/partner/logout',partnerAuth,(req,res)=>{const h=String(req.headers.authorization||''),token=h.startsWith('Bearer ')?h.slice(7).trim():'';partnerSessions.delete(token);res.json({ok:true});});
app.get('/api/partner/orders',partnerAuth,(req,res)=>{try{const d=db();const orders=[...d.orders].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));res.json({ok:true,orders});}catch(e){console.error(e);res.status(500).json({error:'Could not load partner orders'});}});
app.post('/api/partner/orders/:id/status',partnerAuth,async(req,res)=>{
try{
const d=db();
const o=d.orders.find(x=>x.id===req.params.id);

if(!o){
return res.status(404).json({error:'Order not found'});
}

const requested=String(req.body?.status||'').toUpperCase();

const allowed={
NEW:'CONFIRMED',
CONFIRMED:'SHIPPED',
SHIPPED:'DELIVERED'
};

if(allowed[o.status]!==requested){
return res.status(400).json({error:'Invalid status transition'});
}


if(requested==='CONFIRMED'){

if(o.confirmedAt){
return res.status(400).json({error:'Order already confirmed'});
}

o.status='CONFIRMED';
o.confirmedAt=new Date().toISOString();

const c=d.customers.find(x=>x.id===o.customerId);

if(c){

const confirmText=`GOLDEN HONEY FUSION

${customerEnglishName(c.name)}،

تم تأكيد طلبك بنجاح.

رقم الطلب: ${o.orderNumber||o.id}

شكراً لثقتك واختيارك.

مع خالص التقدير،
GHF`;

const waResult = await sendCloud(c.phone,confirmText);
console.log("CONFIRM RESULT:", c.phone, waResult);

}

}


if(requested==='SHIPPED'){

if(o.shippedAt){
return res.status(400).json({error:'Order already shipped'});
}

o.status='SHIPPED';
o.shippedAt=new Date().toISOString();

const c=d.customers.find(x=>x.id===o.customerId);

if(c){

const shipText=`GOLDEN HONEY FUSION

${customerEnglishName(c.name)}،

تم شحن طلبك وأصبح في طريقه إليك.

رقم الطلب: ${o.orderNumber||o.id}

مع خالص التقدير،
GHF`;

await sendCloud(c.phone,shipText);

}

}


if(requested==='DELIVERED'){

o.status='DELIVERED';
o.deliveredAt=new Date().toISOString();

const c=d.customers.find(x=>x.id===o.customerId);

if(c){
if(o.discountAmount && o.discountAmount>0){

if(!d.privilegeUses)d.privilegeUses=[];

d.privilegeUses.push({
  id:id('USE'),
  customerId:c.id,
  orderId:o.id,
  customer:c.name,
  phone:c.phone,
  amount:o.discountAmount,
  balanceAfter:0,
  createdAt:new Date().toISOString()
});

}

c.purchases++;
c.consecutivePurchases++;

const earnedBase=money(
o.discountedSubtotal!=null?
o.discountedSubtotal:
o.subtotal
);

const b=computeBenefit(c,earnedBase);

c.benefitRate=b.rate;
c.benefitBalance=b.amount;
c.benefitExpiresAt=b.expiresAt;
c.benefitUsedOrderId=null;
c.privilegeCode=makePrivilegeCode(d);

if(!d.privileges)d.privileges=[];

const newPrivilege={
  id:id('PRV'),
  customerId:c.id,
  orderId:o.id,
  customer:c.name,
  phone:c.phone,
  code:c.privilegeCode,
  amount:earnedBase,
  rate:b.rate,
  earned:b.amount,
  expiresAt:b.expiresAt,
  sent:false,
  createdAt:new Date().toISOString()
};

d.privileges.push(newPrivilege);

// تجهيز رسالة الامتياز الجديدة للأدمن
const privilegeText=`GOLDEN HONEY FUSION

${customerEnglishName(c.name)}،

شكراً لثقتك المتكررة واختيارك Golden Honey Fusion.

ملخص امتياز الشراء الخاص بك:

⭐ عدد مرات الشراء: ${c.purchases || 0}
⭐ مستوى الامتياز: ${(c.benefitRate*100).toFixed(1)}%
⭐ رصيد الامتياز الحالي: $${money(c.benefitBalance).toFixed(2)}

كود الامتياز: ${p.code}

صالح حتى: ${new Date(p.expiresAt).toLocaleDateString('en-GB')}

نقدّر ثقتك ونتطلع لتجربة جديدة مع Golden Honey Fusion.

مع خالص التقدير،
GHF`;

newPrivilege.message=privilegeText;

}

}

save(d);

res.json({ok:true,order:o});


}catch(e){

console.error(e);

res.status(500).json({
error:'Could not update order status'
});

}

});
app.get('/api/partner/orders/:id/status-message',partnerAuth,(req,res)=>{try{const d=db(),o=d.orders.find(x=>x.id===req.params.id);if(!o)return res.status(404).json({error:'Order not found'});const statusText={NEW:'Your order has been received.',CONFIRMED:'Your order has been confirmed.',SHIPPED:'Your order has been shipped and is out for delivery.',DELIVERED:'Your order has been delivered. Thank you for choosing Golden Honey Fusion.'}[o.status]||('Your order status is '+o.status+'.');res.json({ok:true,message:`Golden Honey Fusion\n\nOrder ${o.id}\n${statusText}`});}catch(e){console.error(e);res.status(500).json({error:'Could not prepare status message'});}});

function orderHtml(o){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Golden Honey Fusion Invoice ${o.id}</title><style>
body{margin:0;background:#f3ead8;color:#3b3020;font-family:Georgia,serif;padding:25px}
.card{max-width:760px;margin:auto;background:#fffaf0;border:2px solid #c8a24a;padding:35px;box-shadow:0 10px 35px #b9a47a}
.header{text-align:center;color:#b8862c;letter-spacing:4px;font-size:18px}
.line{height:1px;background:#c8a24a;margin:20px 0}
.title{text-align:center;color:#b8862c;font-size:30px}
.row{padding:9px 0;border-bottom:1px solid #ead9b8}
.gold{color:#b8862c}
.total{font-size:22px;font-weight:bold;text-align:right;color:#b8862c}
.stamp{margin:35px auto 0;width:120px;height:120px;border:3px solid #b8862c;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;color:#b8862c;font-weight:bold;letter-spacing:2px}
</style></head><body><div class="card">

<div class="header">GOLDEN HONEY FUSION</div>

<div class="line"></div>

<div class="title">INVOICE</div>

<div class="row">Order ID: ${o.id}</div>
<div class="row">Customer ID: ${o.customerId}</div>
<div class="row">Customer: ${escapeHtml(o.customer.name)}</div>
<div class="row">Phone: ${escapeHtml(o.customer.phone)}</div>
<div class="row">Governorate: ${escapeHtml(o.customer.province)}</div>
<div class="row">Town / City: ${escapeHtml(o.customer.city)}</div>
<div class="row">Address: ${escapeHtml(o.customer.address)}</div>

<div class="line"></div>

<h3 class="gold">ORDER DETAILS</h3>

${o.items.map(i=>`<div class="row">${escapeHtml(i.product)} — ${escapeHtml(i.weight)} × ${i.qty} — $${money(i.lineTotal).toFixed(2)}</div>`).join('')}

<div class="line"></div>

<div>SUBTOTAL: $${money(o.subtotal).toFixed(2)}</div>
${o.discountAmount?`<div>PRIVILEGE DISCOUNT: -$${money(o.discountAmount).toFixed(2)}</div>`:''}
<div>DELIVERY: $${money(o.deliveryFee).toFixed(2)}</div>

<p class="total">TOTAL $${money(o.total).toFixed(2)}</p>

<div class="stamp">GHF<br>GOLDEN<br>QUALITY</div>

</div></body></html>`;}
function escapeHtml(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));} 
app.get('/api/admin/privileges',(req,res)=>{
  try{
    const d=db();
    res.json({
      privileges:d.privileges || []
    });
  }catch(e){
    console.error(e);
    res.status(500).json({error:'Cannot load privileges'});
  }
});

app.post('/api/admin/privileges/:id/sent',async(req,res)=>{
try{

const d=db();

const p=d.privileges.find(x=>x.id===req.params.id);

if(!p){
return res.status(404).json({error:'Privilege not found'});
}

if(p.sent){
return res.status(400).json({error:'Privilege already sent'});
}

const c=d.customers.find(x=>x.id===p.customerId);

if(!c){
return res.status(404).json({error:'Customer not found'});
}


const privilegeText=`GOLDEN HONEY FUSION

${customerEnglishName(c.name)}،

شكراً لثقتك واختيارك.

لقد حصلت الآن على امتياز بقيمة $${money(p.earned).toFixed(2)}.

وأصبح رصيد امتياز الشراء الخاص بك:
$${money(c.benefitBalance).toFixed(2)}

كود الامتياز: ${p.code}

صالح حتى: ${new Date(p.expiresAt).toLocaleDateString('en-GB')}

مع خالص التقدير،
GHF`;

await sendCloud(c.phone,privilegeText);


p.sent=true;
p.sentAt=new Date().toISOString();

save(d);

res.json({ok:true});

}catch(e){

console.error(e);

res.status(500).json({
error:'Could not send privilege'
});

}

});
app.get('/api/admin/reviews',(req,res)=>{
try{

const d=db();
const now=new Date();

const reviews = d.orders.filter(o=>{

const delivered = new Date(o.deliveredAt);
const days = (now - delivered) / (1000*60*60*24);

const alreadySent = (d.reviewRequests || []).some(r=>r.orderId===o.id);

return o.status === 'DELIVERED' &&
       o.deliveredAt &&
       days >= 10 &&
       !alreadySent;
}).map(o=>({

  id:o.id,
  orderId:o.id,
  customerId:o.customerId,
  customer:o.customer?.name || '',
  phone:o.customer?.phone || '',
  createdAt:o.createdAt

}));

res.json({reviews});

}catch(e){

console.error(e);
res.status(500).json({error:'Cannot load reviews'});

}
});
app.get('/api/admin/ratings',(req,res)=>{

try{

const d=db();
console.log("RATINGS DEBUG:", d.customerReviews);
res.json({
reviews:d.customerReviews || []
});

}catch(e){

res.status(500).json({
error:"Cannot load ratings"
});

}

});
app.post('/api/admin/reviews/:id/sent',async(req,res)=>{
try{

const d=db();

const order=d.orders.find(o=>o.id===req.params.id);

if(!order){
return res.status(404).json({error:'Order not found'});
}

if((d.reviewRequests||[]).some(r=>r.orderId===order.id)){
return res.status(400).json({error:'Review already sent'});
}

const customerName=customerEnglishName(order.customer?.name||'');

const reviewText=`GOLDEN HONEY FUSION

Mr/Ms ${customerName}،

مرّت عشرة أيام على استلام طلبكم من Golden Honey Fusion، ويسعدنا أن نعرف رأيكم بكل صدق.

تجربتكم تهمّنا، لأن اختياركم وثقتكم هما الأساس الذي نبني عليه دائماً.

نرجو منكم تخصيص دقيقة واحدة لمشاركة تقييمكم للمنتج والتجربة:

⭐ جودة المنتج
⭐ الطعم والرائحة
⭐ التغليف
⭐ مستوى الخدمة
⭐ تجربتكم بشكل عام

رأيكم يساعدنا على الاستمرار في تقديم مستوى يليق بثقتكم.

شكراً من القلب لثقتكم بـ Golden Honey Fusion.

مع خالص التقدير،
GHF`;

console.log("REVIEW SEND TO:", order.customer?.phone);

const waResult = await sendCloud(order.customer?.phone,reviewText);
console.log("REVIEW WHATSAPP RESULT:",waResult);

if(waResult.sent){

if(!d.reviewRequests)d.reviewRequests=[];

d.reviewRequests.push({
 orderId:order.id,
 customerId:order.customerId,
 sentAt:new Date().toISOString()
});

save(d);

}

res.json({ok:true});

}catch(e){

console.error(e);

res.status(500).json({
error:'Could not send review'
});

}
});
app.post('/api/reviews/submit',async(req,res)=>{
try{

const d=db();

const {orderId,ratings,comment}=req.body||{};

const order=d.orders.find(o=>o.id===orderId);

if(!order){
return res.status(404).json({error:'Order not found'});
}

if((d.reviews||[]).some(r=>r.orderId===orderId)){
return res.status(400).json({error:'Review already submitted'});
}

const review={
orderId:order.id,
customerId:order.customerId,
customer:order.customer?.name||'',
ratings:ratings||{},
comment:comment||'',
createdAt:new Date().toISOString()
};

if(!d.reviews)d.reviews=[];

d.reviews.push(review);


const customer=d.customers.find(c=>c.id===order.customerId);

if(customer){
addBenefit(customer,0.50);
}

save(d);

res.json({ok:true});

}catch(e){

console.error(e);

res.status(500).json({
error:'Could not submit review'
});

}
});
async function runReviewScheduler(){
  try{
    const d=db();
    if(!d.reviewRequests)d.reviewRequests=[];

    const now=Date.now();
    const TEN_DAYS=10*24*60*60*1000;

    for(const order of (d.orders||[])){
      if(order.status!=='DELIVERED') continue;
      if(!order.deliveredAt) continue;

const alreadySent =
  (d.reviewRequests || []).some(r=>r.orderId===order.id) ||
  (d.reviews || []).some(r=>r.orderId===order.id);

      if(alreadySent) continue;

      const deliveredTime=new Date(order.deliveredAt).getTime();
      if(!deliveredTime) continue;

      if(now-deliveredTime < TEN_DAYS) continue;

      const customerName=customerEnglishName(
        order.customer?.name||''
      );

      const reviewLink=`${BASE_URL}/review.html?id=${order.id}`;

const reviewText=`GOLDEN HONEY FUSION

Mr/Ms ${customerName}،

يسعدنا أن نعرف رأيكم بتجربتكم معنا.

نرجو مشاركتنا تقييمكم من خلال الرابط:
🔗 ${reviewLink}

مع خالص التقدير،
GHF`;
      console.log("AUTO REVIEW SEND TO:",order.customer?.phone);

      const result=await sendCloud(
        order.customer?.phone,
        reviewText
      );

      console.log("AUTO REVIEW RESULT:",result);

      if(result.sent){
        d.reviewRequests.push({
          orderId:order.id,
          customerId:order.customerId,
          sentAt:new Date().toISOString(),
          automatic:true
        });
      }
    }

    save(d);

  }catch(e){
    console.error("REVIEW SCHEDULER ERROR:",e);
  }
}

setInterval(runReviewScheduler,60*60*1000);
runReviewScheduler();
app.listen(PORT,()=>console.log(`GHF backend listening on ${PORT}`));