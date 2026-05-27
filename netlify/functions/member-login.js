// netlify/functions/member-login.js
// Authenticates a member by email + member_number against rr_members

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const { email, password } = JSON.parse(event.body);

    if (!email || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Email and member number are required.' })
      };
    }

    // Look up member by email (case-insensitive) AND member_number
    const query = `email=ilike.${encodeURIComponent(email)}&member_number=eq.${encodeURIComponent(password)}&select=id,first_name,last_name,email,member_number,membership_level,rank,admin_type`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rr_members?${query}&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    const members = await res.json();

    if (!members || members.length === 0) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid email or member number. Please check your details.' })
      };
    }

    const member = members[0];

    // Return safe member data (no sensitive fields)
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id:               member.id,
        first_name:       member.first_name,
        last_name:        member.last_name,
        email:            member.email,
        member_number:    member.member_number,
        membership_level: member.membership_level,
        rank:             member.rank,
        admin_type:       member.admin_type || 'None'
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Server error. Please try again.' })
    };
  }
};
