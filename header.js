// header.js — shared nav for rr-website
// Usage: replace <header>…</header> on each page with:
//   <div id="site-header"></div>
//   <script src="header.js"></script>

(function () {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  const onIndex = (page === 'index.html' || page === '');

  function anchor(hash, label) {
    const href = onIndex ? hash : 'index.html' + hash;
    return '<a href="' + href + '">' + label + '</a>';
  }

  function pageLink(href, label) {
    const active = (page === href) ? ' style="color:#c9a84c;border-bottom:2px solid #c9a84c;"' : '';
    return '<a href="' + href + '"' + active + '>' + label + '</a>';
  }

  const tourHref = onIndex ? '#museum' : 'index.html#museum';

  const html = '<header id="topbar">'
    + '<a href="index.html" class="logo-nav">'
    + '<img src="logo.png" alt="Tampa Rough Riders Logo" style="width:48px;height:48px;object-fit:contain;flex-shrink:0;"/>'
    + '<span>Tampa Rough Riders</span>'
    + '</a>'
    + '<nav>'
    + anchor('#history', 'History')
    + anchor('#gallery', 'Gallery')
    + anchor('#museum', 'Museum')
    + pageLink('events.html', 'Events')
    + anchor('#donate', 'Donate')
    + '<button class="member-btn" onclick="openMemberModal()">Member Login</button>'
    + '<a href="' + tourHref + '" class="cta-btn">Tour</a>'
    + '<a href="admin.html" title="Admin Panel"'
    + ' style="color:rgba(201,168,76,0.4);font-size:2.2rem;text-decoration:none;padding:0 0.3rem;transition:color 0.2s;"'
    + ' onmouseover="this.style.color=\'#c9a84c\'"'
    + ' onmouseout="this.style.color=\'rgba(201,168,76,0.4)\'"'
    + '>&#9881;</a>'
    + '</nav>'
    + '<button class="nav-toggle" onclick="toggleNav()">&#9776;</button>'
    + '</header>';

  const target = document.getElementById('site-header');
  if (target) {
    target.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }
})();
