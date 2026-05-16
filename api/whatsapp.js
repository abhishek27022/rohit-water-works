import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Simple in-memory sessions for testing. For large production, move this to a DB table.
const sessions = globalThis.__rww_sessions || {};
globalThis.__rww_sessions = sessions;

function xmlEscape(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function sendTwiml(res, message) {
  res.setHeader('Content-Type', 'text/xml');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`);
}

function getTwilioBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    return Object.fromEntries(new URLSearchParams(req.body));
  }
  return req.body;
}

function cleanPhone(from = '') {
  // Twilio sends "whatsapp:+919876543210"
  return String(from).replace('whatsapp:', '').replace('+', '').trim();
}

function normalizeText(text = '') {
  return String(text).trim();
}

function timeStrTo24h(t) {
  const [h, period] = String(t).split(' ');
  let hour = parseInt(h, 10);
  if (period === 'PM' && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, '0')}:00:00`;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

async function logMessage(phone, direction, message) {
  try {
    await supabase.from('whatsapp_messages').insert({
      phone,
      direction,
      message
    });
  } catch (err) {
    console.error('WhatsApp log error:', err.message);
  }
}

async function createBooking(phone, session) {
  if (!session?.name) throw new Error('Missing customer name.');
  if (!session?.address) throw new Error('Missing address.');
  if (!session?.size || !session?.price) throw new Error('Missing tanker size.');
  if (!session?.time) throw new Error('Missing time slot.');
  if (!session?.payment) throw new Error('Missing payment method.');

  let { data: customer, error: customerFindError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (customerFindError) throw customerFindError;

  if (!customer) {
    const { data, error } = await supabase
      .from('customers')
      .insert({
        phone,
        name: session.name
      })
      .select()
      .single();

    if (error) throw error;
    customer = data;
  } else if (customer.name !== session.name) {
    await supabase
      .from('customers')
      .update({ name: session.name })
      .eq('id', customer.id);
  }

  const { data: address, error: addressError } = await supabase
    .from('addresses')
    .insert({
      customer_id: customer.id,
      label: 'WhatsApp delivery',
      full_address: session.address,
      area: 'Shamshabad',
      landmark: null
    })
    .select()
    .single();

  if (addressError) throw addressError;

  const totalAmount = session.price + 10;

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      customer_id: customer.id,
      address_id: address.id,
      tanker_size_kl: session.size,
      scheduled_date: todayIsoDate(),
      scheduled_time: timeStrTo24h(session.time),
      base_price: session.price,
      platform_fee: 10,
      total_amount: totalAmount,
      payment_method: session.payment,
      payment_status: session.payment === 'upi' ? 'verifying' : 'pending',
      booking_status: 'pending',
      customer_notes: 'Created from WhatsApp bot'
    })
    .select()
    .single();

  if (bookingError) throw bookingError;

  return booking;
}

async function getTrackingInfo(phone) {
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (!customer) {
    return `No booking found for this number.\n\nReply *book* to book a tanker.`;
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .select(`
      id,
      booking_status,
      tanker_size_kl,
      scheduled_time,
      total_amount,
      payment_method,
      payment_status,
      drivers(name, phone, vehicle_number)
    `)
    .eq('customer_id', customer.id)
    .in('booking_status', ['pending', 'assigned', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  if (!booking) {
    return `No active booking found.\n\nReply *book* to book a tanker.`;
  }

  if (!booking.drivers) {
    return `📋 *Booking #RW${booking.id}*\n\nStatus: ${booking.booking_status}\nTanker: ${booking.tanker_size_kl} KL\nAmount: ₹${booking.total_amount}\n\nDriver is not assigned yet.`;
  }

  return `🚛 *Your tanker update*\n\nBooking: #RW${booking.id}\nStatus: ${booking.booking_status}\nDriver: ${booking.drivers.name}\nPhone: ${booking.drivers.phone}\nVehicle: ${booking.drivers.vehicle_number}\nTanker: ${booking.tanker_size_kl} KL\nAmount: ₹${booking.total_amount}`;
}

async function getBookingHistory(phone) {
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (!customer) return `No bookings found yet.\n\nReply *book* to book a tanker.`;

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, scheduled_date, tanker_size_kl, total_amount, booking_status')
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  if (!bookings?.length) return `No bookings found yet.\n\nReply *book* to book a tanker.`;

  let reply = `📋 *Your recent bookings:*\n\n`;
  for (const b of bookings) {
    reply += `#RW${b.id} · ${b.scheduled_date}\n${b.tanker_size_kl} KL · ₹${b.total_amount} · ${b.booking_status}\n\n`;
  }
  return reply.trim();
}

function resetSession(phone) {
  sessions[phone] = { step: 'start' };
}

function askMenu() {
  return `👋 Welcome to *Rohit Water Works*!\nShamshabad water tanker delivery\n\nReply with a number:\n1️⃣ Book a tanker\n2️⃣ Track my order\n3️⃣ My recent bookings\n4️⃣ Call us\n\nOr type *book* to start.`;
}

function askSize() {
  return `🚰 *Choose tanker size:*\n\n1️⃣ *5 KL* — ₹700\n2️⃣ *10 KL* — ₹1,200\n\nReply *1* or *2*`;
}

function askTime() {
  return `When do you want the tanker delivered?\n\n1️⃣ 8 AM\n2️⃣ 10 AM\n3️⃣ 12 PM\n4️⃣ 2 PM\n5️⃣ 4 PM\n6️⃣ 6 PM\n\nReply with a number 1-6.`;
}

async function processMessage(phone, incomingMessage) {
  const message = normalizeText(incomingMessage);
  const msg = message.toLowerCase();
  const session = sessions[phone] || { step: 'start' };
  sessions[phone] = session;

  if (['hi', 'hello', 'hey', 'start', 'menu', 'reset'].includes(msg)) {
    resetSession(phone);
    return askMenu();
  }

  if (msg === '4' || msg.includes('call') || msg.includes('phone')) {
    resetSession(phone);
    return `📞 *Call Rohit Water Works:*\n+91 9010644206`;
  }

  if (msg === '2' || msg.includes('track') || msg.includes('where')) {
    return await getTrackingInfo(phone);
  }

  if (msg === '3' || msg.includes('history') || msg.includes('recent')) {
    return await getBookingHistory(phone);
  }

  if (msg.includes('book') || msg.includes('tanker') || msg.includes('water') || (session.step === 'start' && msg === '1')) {
    session.step = 'size';
    return askSize();
  }

  if (session.step === 'size') {
    if (msg === '1') {
      session.size = 5;
      session.price = 700;
    } else if (msg === '2') {
      session.size = 10;
      session.price = 1200;
    } else {
      return `Please reply *1* for 5 KL or *2* for 10 KL.`;
    }

    session.step = 'time';
    return askTime();
  }

  if (session.step === 'time') {
    const timeMap = {
      '1': '8 AM',
      '2': '10 AM',
      '3': '12 PM',
      '4': '2 PM',
      '5': '4 PM',
      '6': '6 PM'
    };

    if (!timeMap[msg]) return `Please reply with a number from 1 to 6 for the time slot.`;

    session.time = timeMap[msg];
    session.step = 'name';

    return `Great. Booking ${session.size} KL for *today ${session.time}*.\n\nPlease send your name.`;
  }

  if (session.step === 'name') {
    if (message.length < 2) return `Please send your full name.`;

    session.name = message;
    session.step = 'address';

    return `Thanks ${session.name}.\n\nPlease send your *delivery address* in Shamshabad.\nExample: Plot 14, Rajiv Nagar, near blue gate`;
  }

  if (session.step === 'address') {
    if (message.length < 5) return `Please send a complete delivery address.`;

    session.address = message;
    session.step = 'payment';

    return `Almost done.\n\n*Payment method:*\n1️⃣ UPI / QR — ₹${session.price + 10}\n2️⃣ Cash on delivery — ₹${session.price + 10}\n\nReply *1* or *2*.`;
  }

  if (session.step === 'payment') {
    if (msg !== '1' && msg !== '2') return `Please reply *1* for UPI or *2* for Cash on Delivery.`;

    session.payment = msg === '1' ? 'upi' : 'cod';

    const booking = await createBooking(phone, session);
    const totalAmount = session.price + 10;

    if (session.payment === 'upi') {
      session.bookingId = booking.id;
      session.step = 'awaiting_payment';

      return `✅ *Booking created!* #RW${booking.id}\n\nTanker: ${session.size} KL\nTime: Today ${session.time}\nAmount: ₹${totalAmount}\n\nPlease pay via UPI:\nUPI ID: *rohitwaterworks@ybl*\n\nAfter paying, send your UPI transaction/reference number here.`;
    }

    resetSession(phone);
    return `✅ *Booking confirmed!* #RW${booking.id}\n\n📦 ${session.size} KL tanker\n🕐 Today ${session.time}\n📍 ${session.address}\n💵 Keep ₹${totalAmount} cash ready\n\nDriver will call before arrival.`;
  }

  if (session.step === 'awaiting_payment') {
    const txnId = msg.replace(/\s/g, '');

    if (!/^[a-z0-9-]{6,30}$/i.test(txnId)) {
      return `Please send the UPI transaction/reference number from your payment receipt.`;
    }

    await supabase
      .from('bookings')
      .update({
        upi_transaction_id: txnId,
        payment_status: 'verifying'
      })
      .eq('id', session.bookingId);

    await supabase.from('upi_payments').insert({
      booking_id: session.bookingId,
      transaction_id: txnId,
      amount: session.price + 10,
      status: 'pending'
    });

    const bookingId = session.bookingId;
    resetSession(phone);

    return `✅ Transaction ID received.\n\nBooking: *#RW${bookingId}*\nPayment is under verification.\nDriver will be assigned after confirmation.`;
  }

  return `I didn't understand that.\n\nReply *menu* to see options or *book* to book a tanker.`;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('Rohit Water Works WhatsApp bot is running. Use POST from Twilio Sandbox.');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in Vercel environment variables.');
    }

    const body = getTwilioBody(req);
    const phone = cleanPhone(body.From || '');
    const incomingMessage = normalizeText(body.Body || '');

    if (!phone || !incomingMessage) {
      return sendTwiml(res, 'Please send a message like "book".');
    }

    await logMessage(phone, 'in', incomingMessage);

    const reply = await processMessage(phone, incomingMessage);

    await logMessage(phone, 'out', reply);

    return sendTwiml(res, reply);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return sendTwiml(res, `Sorry, something went wrong in the booking bot.\n\nError: ${err.message}`);
  }
}
