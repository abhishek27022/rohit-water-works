```javascript
// Auto-replies to customer WhatsApp messages
import { supabase } from '../shared/supabase.js';

// When customer sends "book", reply with options
async function handleMessage(from, message) {
  const msg = message.toLowerCase().trim();

  if (msg.includes('book') || msg.includes('tanker') || msg.includes('water')) {
    return reply(from,
      `🚰 Rohit Water Works\n\n` +
      `Choose tanker size:\n` +
      `1️⃣ 5 KL — ₹700\n` +
      `2️⃣ 10 KL — ₹1,200\n\n` +
      `Reply 1 or 2`
    );
  }

  if (msg === '1' || msg === '2') {
    const size = msg === '1' ? 5 : 10;
    const price = msg === '1' ? 700 : 1200;
    return reply(from,
      `Great! Booking a ${size} KL tanker for ₹${price}.\n\n` +
      `Send your address to confirm. Example:\n` +
      `"Plot 12, Rajiv Nagar, Shamshabad"`
    );
  }

  if (msg.includes('track')) {
    const { data } = await supabase
      .from('bookings')
      .select('*, drivers(name, phone)')
      .eq('customer_id', from)
      .in('booking_status', ['assigned', 'in_progress'])
      .single();

    if (data) {
      return reply(from,
        `🚛 Your tanker is on the way!\n\n` +
        `Driver: ${data.drivers.name}\n` +
        `Phone: ${data.drivers.phone}\n` +
        `Booking: #${data.id}\n\n` +
        `Track live: rohit-customer.vercel.app/track/${data.id}`
      );
    }
    return reply(from, "No active booking found. Reply 'book' to make one.");
  }

  // Default greeting
  return reply(from,
    `👋 Welcome to Rohit Water Works!\n\n` +
    `Reply:\n` +
    `• "book" to book a tanker\n` +
    `• "track" to track your order\n` +
    `• Call us: +91 9010644206`
  );
}
