```javascript
// shared/supabase.js — connects every app to the database
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Paste your values from Supabase Step 1.4 here:
const SUPABASE_URL = 'https://cwrpxrtukhmpngfbkpuz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3cnB4cnR1a2htcG5nZmJrcHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MDEwMDMsImV4cCI6MjA5NDQ3NzAwM30.c08urAF0aMYnODwFg4F_v43bQUaL-MrYEnoBsjqUYGg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Helper: book a tanker
export async function createBooking(data) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert(data)
    .select()
    .single();
  return { booking, error };
}

// Helper: get all today's bookings (for admin)
export async function getTodayBookings() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('bookings')
    .select('*, customers(name, phone), addresses(area), drivers(name)')
    .eq('scheduled_date', today)
    .order('scheduled_time');
  return { data, error };
}

// Helper: get available drivers (online + tank > 30%)
export async function getAvailableDrivers() {
  const { data } = await supabase
    .from('drivers')
    .select('*')
    .eq('is_online', true)
    .gte('current_tank_pct', 30);
  return data;
}

// Helper: assign a driver to a booking
export async function assignDriver(bookingId, driverId) {
  const { error } = await supabase
    .from('bookings')
    .update({ driver_id: driverId, booking_status: 'assigned' })
    .eq('id', bookingId);
  return { error };
}

// Helper: mark cash collected (driver app)
export async function markCashCollected(bookingId) {
  const { error } = await supabase
    .from('bookings')
    .update({
      cash_collected: true,
      cash_collected_at: new Date().toISOString(),
      booking_status: 'completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', bookingId);
  return { error };
}

// Helper: subscribe to real-time updates (for live tracking)
export function subscribeBookings(callback) {
  return supabase
    .channel('bookings-changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'bookings' },
      callback
    )
    .subscribe();
}
```
