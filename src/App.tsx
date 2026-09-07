export function App() {
  const hidSupported = typeof navigator !== 'undefined' && 'hid' in navigator
  return (
    <main>
      <h1>GravaStar Hub</h1>
      <p>{hidSupported ? 'WebHID available.' : 'This browser has no WebHID — use Chrome, Edge or Arc.'}</p>
    </main>
  )
}
