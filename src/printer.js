let device=null;
let characteristic=null;
const REMEMBERED_NAME_KEY='periclesdevcomanda.lastPrinterName';
const REMEMBERED_ID_KEY='periclesdevcomanda.lastPrinterId';
function rememberedName(){try{return localStorage.getItem(REMEMBERED_NAME_KEY)||''}catch{return ''}}
function isIOS(){
  const ua=navigator?.userAgent||'';
  return /iPad|iPhone|iPod/.test(ua)||(navigator?.platform==='MacIntel'&&navigator?.maxTouchPoints>1);
}
function bluetoothUnavailableMessage(){
  if(isIOS())return 'A impressão Bluetooth direta não está disponível no iPhone/iPad. Use o terminal Android/Windows conectado à impressora ou uma solução de impressão em rede.';
  return 'Este navegador não oferece impressão Bluetooth direta. Use Chrome/Edge em Android ou Windows, em HTTPS ou localhost.';
}
function rememberPrinter(selected,name){
  try{
    const id=selected?.id||'';
    localStorage.setItem(REMEMBERED_NAME_KEY,name);
    if(id)localStorage.setItem(REMEMBERED_ID_KEY,id);
  }catch{}
}
let state={connected:false,name:'',rememberedName:rememberedName(),mode:'none'};

const SERVICE_UUIDS=[
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ffb0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
];

function clean(text=''){
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E\n\r]/g,'');
}

export function getPrinterState(){return {...state};}

async function findWritableCharacteristic(server){
  const services=await server.getPrimaryServices();
  for(const service of services){
    try{
      const chars=await service.getCharacteristics();
      for(const c of chars){
        if(c.properties.writeWithoutResponse||c.properties.write)return c;
      }
    }catch{}
  }
  throw new Error('A impressora conectou, mas não foi encontrado um canal de escrita compatível. Precisaremos configurar o modelo da impressora.');
}

function connectionMessage(error){
  const raw=String(error?.message||error||'').trim();
  if(/Connection Error|Connection attempt failed|NetworkError/i.test(raw)){
    return 'Não foi possível conectar à impressora. Confirme que ela está ligada, com o Bluetooth ativo, próxima deste aparelho e não conectada a outro celular/computador. Depois toque em “Escolher impressora” e tente novamente.';
  }
  if(/GATT|disconnected|connect/i.test(raw)){
    return 'A conexão Bluetooth com a impressora foi interrompida. Desligue e ligue a impressora, confira se ela não está conectada a outro aparelho e tente novamente.';
  }
  return raw||'Não foi possível conectar à impressora Bluetooth.';
}

async function connectDevice(selected){
  device=selected;
  characteristic=null;
  if(!device?.gatt)throw new Error('O dispositivo selecionado não oferece Bluetooth BLE compatível com este navegador.');
  let server=null;
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      if(device.gatt.connected)device.gatt.disconnect();
      if(attempt)await new Promise(r=>setTimeout(r,700));
      server=await device.gatt.connect();
      characteristic=await findWritableCharacteristic(server);
      break;
    }catch(error){
      lastError=error;
      characteristic=null;
      try{if(device?.gatt?.connected)device.gatt.disconnect();}catch{}
    }
  }
  if(!characteristic)throw new Error(connectionMessage(lastError));
  const name=device.name||'Impressora Bluetooth';
  rememberPrinter(device,name);
  state={connected:true,name,rememberedName:name,mode:'ble-escpos'};
  device.addEventListener('gattserverdisconnected',()=>{characteristic=null;state={connected:false,name:device?.name||'',rememberedName:rememberedName(),mode:'none'};},{once:true});
  return getPrinterState();
}

export async function connectPreviousPrinter(){
  if(!navigator.bluetooth)throw new Error(bluetoothUnavailableMessage());
  if(typeof navigator.bluetooth.getDevices!=='function')throw new Error('Este navegador não permite recuperar a impressora anterior automaticamente. Use “Escolher impressora”.');
  const devices=await navigator.bluetooth.getDevices();
  if(!devices?.length)throw new Error('Nenhuma impressora Bluetooth autorizada anteriormente foi encontrada neste navegador.');
  let savedId='';try{savedId=localStorage.getItem(REMEMBERED_ID_KEY)||''}catch{}
  const savedName=rememberedName();
  const previous=devices.find(d=>savedId&&d.id===savedId)||devices.find(d=>savedName&&d.name===savedName)||devices[0];
  return connectDevice(previous);
}


export async function connectBluetoothPrinter(){
  if(!navigator.bluetooth)throw new Error(bluetoothUnavailableMessage());
  if(navigator.bluetooth.getAvailability){
    const available=await navigator.bluetooth.getAvailability();
    if(!available)throw new Error('O Bluetooth está desligado ou indisponível. Ative o Bluetooth do dispositivo e tente novamente.');
  }
  const selected=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:SERVICE_UUIDS});
  return connectDevice(selected);
}

export function disconnectPrinter(){
  if(device?.gatt?.connected)device.gatt.disconnect();
  characteristic=null;state={connected:false,name:device?.name||'',rememberedName:rememberedName(),mode:'none'};
}

async function writeBytes(bytes){
  if(!characteristic||!device?.gatt?.connected)throw new Error('Nenhuma impressora Bluetooth está conectada.');
  const size=100;
  for(let i=0;i<bytes.length;i+=size){
    const chunk=bytes.slice(i,i+size);
    if(characteristic.properties.writeWithoutResponse&&characteristic.writeValueWithoutResponse)await characteristic.writeValueWithoutResponse(chunk);
    else await characteristic.writeValue(chunk);
    await new Promise(r=>setTimeout(r,25));
  }
}

async function printText(text){
  const enc=new TextEncoder();
  const init=new Uint8Array([0x1b,0x40]);
  const body=enc.encode(clean(text));
  const feed=new Uint8Array([0x0a,0x0a,0x0a,0x0a]);
  const cut=new Uint8Array([0x1d,0x56,0x00]);
  const out=new Uint8Array(init.length+body.length+feed.length+cut.length);
  out.set(init,0);out.set(body,init.length);out.set(feed,init.length+body.length);out.set(cut,init.length+body.length+feed.length);
  await writeBytes(out);
}

export async function printTestReceipt(){
  await printText(`ESPETO'S PRIME\nTESTE DE IMPRESSAO\n-------------------------------\nImpressora conectada com sucesso.\n`);
}

export async function printOrderReceipt({tableNumber,orderNumber,items,subtotal,discount,total,closedBy,closedAt,reprint=false}){
  const lines=[];
  lines.push("ESPETO'S PRIME");
  if(reprint)lines.push('*** REIMPRESSAO ***');
  lines.push(`MESA ${tableNumber}  COMANDA #${orderNumber}`);
  lines.push('-------------------------------');
  for(const i of items||[]){
    const name=`${i.quantity}x ${i.product_name_snapshot}${i.variant_name_snapshot?' - '+i.variant_name_snapshot:''}`;
    lines.push(name);
    if(i.notes)lines.push(`  Obs: ${i.notes}`);
    const unit=Number(i.unit_price||0);
    const itemTotal=unit*Number(i.quantity||0);
    lines.push(`  Unit: R$ ${unit.toFixed(2).replace('.',',')}  Total: R$ ${itemTotal.toFixed(2).replace('.',',')}`);
  }
  lines.push('-------------------------------');
  lines.push(`SUBTOTAL: R$ ${Number(subtotal||0).toFixed(2).replace('.',',')}`);
  if(Number(discount||0)>0)lines.push(`DESCONTO: - R$ ${Number(discount||0).toFixed(2).replace('.',',')}`);
  lines.push(`TOTAL: R$ ${Number(total||0).toFixed(2).replace('.',',')}`);
  lines.push(`Encerrado por: ${closedBy||'Administrador'}`);
  const receiptDate=closedAt?new Date(closedAt):new Date();
  lines.push(receiptDate.toLocaleString('pt-BR',{timeZone:'America/Recife'}));
  await printText(lines.join('\n')+'\n');
}


export async function printDailyMovementReport(report){
  if(!report)throw new Error('Relatório não encontrado.');
  const paymentLabels={cash:'DINHEIRO',pix:'PIX',credit:'CREDITO',debit:'DEBITO'};
  const brl=v=>`R$ ${Number(v||0).toFixed(2).replace('.',',')}`;
  const dateText=String(report.date||'').split('-').reverse().join('/');
  const lines=[];
  lines.push("ESPETO'S PRIME");
  lines.push('RELATORIO DE MOVIMENTO');
  lines.push(`DATA: ${dateText}`);
  lines.push('===============================');

  for(const order of report.orders||[]){
    lines.push(`MESA ${order.table_number}  COMANDA #${order.order_number}`);
    const closedAt=order.closed_at?new Date(order.closed_at).toLocaleTimeString('pt-BR',{timeZone:'America/Recife',hour:'2-digit',minute:'2-digit'}):'';
    if(closedAt)lines.push(`Fechamento: ${closedAt}`);
    for(const item of order.items||[]){
      const variant=item.variant?` - ${item.variant}`:'';
      lines.push(`${item.quantity}x ${item.name}${variant}`);
      if(item.notes)lines.push(`  Obs: ${item.notes}`);
      lines.push(`  ${brl(item.unit_price)}  =  ${brl(item.total)}`);
    }
    lines.push(`Subtotal: ${brl(order.subtotal)}`);
    if(Number(order.discount||0)>0)lines.push(`Desconto: - ${brl(order.discount)}`);
    lines.push(`Total: ${brl(order.total)}`);
    if((order.payments||[]).length){
      lines.push('Pagamento(s):');
      for(const pay of order.payments){
        lines.push(`  ${paymentLabels[pay.method]||String(pay.method).toUpperCase()}: ${brl(pay.amount)}`);
      }
    }
    lines.push('-------------------------------');
  }

  const pm=report.payments_by_method||{};
  lines.push('RESUMO DO DIA');
  lines.push(`Mesas/comandas: ${Number(report.orders_count||0)}`);
  lines.push(`Subtotal bruto: ${brl(report.subtotal_total)}`);
  if(Number(report.discount_total||0)>0)lines.push(`Descontos: - ${brl(report.discount_total)}`);
  lines.push(`TOTAL DO DIA: ${brl(report.net_total)}`);
  lines.push('-------------------------------');
  lines.push('FORMAS DE PAGAMENTO');
  lines.push(`Dinheiro: ${brl(pm.cash||0)}`);
  lines.push(`Pix: ${brl(pm.pix||0)}`);
  lines.push(`Credito: ${brl(pm.credit||0)}`);
  lines.push(`Debito: ${brl(pm.debit||0)}`);
  lines.push('===============================');
  lines.push(`Impresso: ${new Date().toLocaleString('pt-BR',{timeZone:'America/Recife'})}`);
  await printText(lines.join('\n')+'\n');
}
