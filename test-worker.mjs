// Test script to verify Worker setup
import { createClient } from '@supabase/supabase-js';

const supaUrl = 'https://ijzukzccrrmsfffewqwj.supabase.co';
const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqenVremNjcnJtc2ZmZmV3cXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3ODkyMzksImV4cCI6MjEwNjM2NTIzOX0.EiM88OWwCMmbPy5xSzDTqUPmF68OywEE6IBb4eDuY5Q';

const supa = createClient(supaUrl, supaKey);

async function test() {
  try {
    // Test connection
    const { data, error } = await supa.from('platform_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    console.log('✅ Supabase connection successful');
    console.log('Platform settings:', data);
  } catch (e) {
    console.error('❌ Supabase connection failed:', e.message);
  }
}

test();