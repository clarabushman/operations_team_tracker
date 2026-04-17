export const config = {
  // This matches all routes, protecting the whole dashboard AND the data.csv file
  matcher: '/(.*)', 
};

export default function middleware(request) {
  const authorizationHeader = request.headers.get('authorization');

  if (authorizationHeader) {
    // Extract the base64 encoded username:password string
    const basicAuth = authorizationHeader.split(' ')[1];
    
    // Decode it (atob is a built-in function in Vercel's edge runtime)
    const [user, password] = atob(basicAuth).split(':');

    // Pull your secret credentials from Vercel's Environment Variables
    const expectedUser = process.env.ADMIN_USERNAME || 'admin';
    const expectedPassword = process.env.ADMIN_PASSWORD || 'secretpassword';

    // If they match, do nothing and let the request continue to the dashboard
    if (user === expectedUser && password === expectedPassword) {
      return; 
    }
  }

  // If there is no password or it's wrong, return a 401 Unauthorized.
  // This specific header triggers the browser's built-in pop-up login box!
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Battery Dashboard"',
    },
  });
}
