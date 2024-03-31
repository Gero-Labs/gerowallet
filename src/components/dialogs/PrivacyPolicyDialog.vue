<template>
  <v-dialog content-class="rounded-xxl dialogStyle" v-model="dialogLocal" scrollable max-width="850">
    <template v-slot:activator="{ on, attrs }">
      <v-btn
          text
          plain
          :ripple="false"
          style="text-transform: capitalize"
          v-bind="attrs" v-on="on"
      >
        {{ $t('privacyPolicy') }}
      </v-btn>
    </template>
    <v-card class="py-0 transparent">
      <v-card-title><h2>
        PRIVACY POLICY
      </h2></v-card-title>
      <v-card-subtitle>
        Last updated May 20, 2022
      </v-card-subtitle>
      <v-card-text>
        <p>This privacy notice for Gero Labs Inc. (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;),
          describes how and why we might collect, store, use, and/or share (&quot;process&quot;) your information when
          you use our services (&quot;Services&quot;), such as when you:</p>
        <ul id="l1">
          <li data-list-text="">
            <p>Visit our website at
              <a href="https://gerowallet.io/" class="s2" target="_blank">https://gerowallet.io</a>,
              or any website of ours that links to this privacy notice.
            </p>
          </li>
          <li data-list-text="">
            <p>Download and use our mobile application (GeroWallet), or any other application of ours that links to this
              privacy notice</p>
          </li>
          <li data-list-text="">
            <p>Engage with us in
              other related ways, including any sales, marketing, or events</p>
          </li>
        </ul>
        <p>Questions or
          concerns? Reading this privacy notice will help you understand your privacy rights and choices. If you do not
          agree with our policies and practices, please do not use our Services. If you still have any questions or
          concerns, please contact us at <a href="mailto:support@gerowallet.io" class="s2" target="_blank">support@gerowallet.io.</a>
        </p>

        <h2>SUMMARY OF KEY POINTS</h2>

        <p style="font-weight: 500; font-style: italic">This
          summary provides key points from our privacy notice, but you can find out more details about any of these
          topics by clicking the link following each key point or by using our table of contents below to find the
          section you are looking for. You can also click <a href="#table-of-contents">here</a>
          to go directly to our table of contents.</p>

        <p><span style="font-weight: 600;">What personal information do we process?</span><br>
          When you visit, use, or navigate our Services, we may process personal
          information depending on how you interact with Gero Labs Inc. and the Services, the choices you make, and the
          products and features you use. Click <a href="#information-collection">here</a> to learn more.</p>

        <p><span style="font-weight: 600;">Do we process any sensitive personal information?</span><br>We do not process
          sensitive personal information.</p>

        <p><span style="font-weight: 600;">Do we receive any information from third parties?</span><br>We do not receive
          any information from third parties.</p>

        <p><span style="font-weight: 600;">How do we process your information?</span><br>We process your information to
          provide, improve, and administer our Services,
          communicate with you, for security and fraud prevention, and to comply with law. We may also process your
          information for other purposes with your consent. We process your information only when we have a valid legal
          reason to do so. Click <a href="#information-processing">here</a> to learn more.</p>

        <p><span
            style="font-weight: 600;">In what situations and with which parties do we share personal information?</span>We
          may share information in
          specific situations and with specific third parties. Click <a href="#personal-information-sharing">here</a> to
          learn more.</p>

        <p><span style="font-weight: 600;">How do we keep your information safe?</span><br>We have organizational and
          technical processes and
          procedures in place to protect your personal information. However, no electronic transmission over the
          internet or information storage technology can be guaranteed to be 100% secure, so we cannot promise or
          guarantee that hackers, cybercriminals, or other unauthorized third parties will not be able to defeat our
          security and improperly collect, access, steal, or modify your information. Click <a href="#information-safety">here</a> to learn
          more.</p>

        <p><span style="font-weight: 600;">What are your rights?</span><br>Depending on where you are located
          geographically, the applicable privacy law
          may mean you have certain rights regarding your personal information. Click <a href="#privacy-rights">here</a> to learn more.
        </p>

        <p><span style="font-weight: 600;">How do I exercise my rights?</span><br>
          The easiest way to exercise your rights is by filling out a data subject request from the contact section <a
              href="https://gerowallet.io/#support" target="_blank">here</a>
          , or by contacting us. We will consider and act upon any request in accordance with applicable data protection
          laws.</p>

        <p>Want to learn more about what Gero Labs Inc. does with any information we collect? Click <a href="#table-of-contents">here</a>
          to review the notice in full.</p>

        <h2 id="table-of-contents">TABLE OF CONTENTS</h2>
        <ol id="l2" class="my-4">
          <li data-list-text="1."><a href="#information-collection">WHAT INFORMATION DO WE COLLECT?</a></li>
          <li data-list-text="2."><a href="#information-processing">HOW DO WE PROCESS YOUR INFORMATION?</a></li>
          <li data-list-text="3."><a href="#information-processing-legal">WHAT LEGAL BASES DO WE RELY ON TO PROCESS YOUR
            INFORMATION?</a></li>
          <li data-list-text="4."><a href="#personal-information-sharing">WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL
            INFORMATION?</a></li>
          <li data-list-text="5."><a href="#cookies-and-tracking">DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?</a>
          </li>
          <li data-list-text="6."><a href="#keeping-information">HOW LONG DO WE KEEP YOUR INFORMATION?</a></li>
          <li data-list-text="7."><a href="#information-safety">HOW DO WE KEEP YOUR INFORMATION SAFE?</a></li>
          <li data-list-text="8."><a href="#minors-information-collection">DO WE COLLECT INFORMATION FROM MINORS?</a></li>
          <li data-list-text="9."><a href="#privacy-rights">WHAT ARE YOUR PRIVACY RIGHTS?</a></li>
          <li data-list-text="10."><a href="#do-not-track">CONTROLS FOR DO-NOT-TRACK FEATURES </a></li>
          <li data-list-text="11."><a href="#california-privacy">DO CALIFORNIA RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?</a></li>
          <li data-list-text="12."><a href="#update-notice">DO WE MAKE UPDATES TO THIS NOTICE?</a></li>
          <li data-list-text="13."><a href="#notice-contact">HOW CAN YOU CONTACT US ABOUT THIS NOTICE?</a></li>
          <li data-list-text="14."><a href="#review-update-delete">HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?</a>
          </li>
        </ol>
        <h2 id="information-collection">1. WHAT INFORMATION DO WE COLLECT?</h2>

        <p>Personal information you disclose to us</p>
        <p style="font-style: italic"><span style="font-weight: 600;">In Short:</span> We collect personal information
          that you provide to us.</p>

        <p>We collect personal information that you voluntarily provide to us when you express an interest in obtaining
          information about us or our
          products and Services, when you participate in activities on the Services, or otherwise when you contact
          us.</p>

        <p><span style="font-weight: 600">Personal Information Provided by You.</span>
          The personal information that we collect depends on the context of your interactions with us and the Services,
          the choices you make, and the products and features you use. The personal information we collect may include
          the following:</p>
        <ul class="mb-4">
          <li data-list-text="">IP address</li>
          <li data-list-text="">Cookies</li>
        </ul>
        <p><span style="font-weight: 600">Sensitive Information.</span> We do not process sensitive information.</p>

        <p><span style="font-weight: 600">Application Data.</span> If you use our application(s), we also may collect
          the following information if you choose to provide us with access or permission:</p>
        <ul class="mb-4">
          <li data-list-text="">
            <span style="font-style: italic">Mobile Device Access.</span> We may request access or permissions to
            certain features from your mobile device, including your mobile device’s camera, storage, and other
            features. If you wish to change our access or permissions, you may do so in your device’s settings.
          </li>
          <li data-list-text="">
            <span style="font-style: italic">Mobile Device Data.</span> We automatically collect device information
            (such as your mobile device ID, model, and manufacturer), operating system, version information and system
            configuration information, device and application identification numbers, browser type and version, hardware
            model Internet service provider and/or mobile carrier, and Internet Protocol (IP) address (or proxy server).
            If you are using our application(s), we may also collect information about the phone network associated with
            your mobile device, your mobile device’s operating system or platform, the type of mobile device you use,
            your
            mobile device’s unique device ID, and information about the features of our application(s) you accessed.
          </li>
        </ul>
        <p>This information is primarily needed to
          maintain the security and operation of our application(s), for troubleshooting, and for our internal
          analytics and reporting purposes.</p>
        <p>All personal information
          that you provide to us must be true, complete, and accurate, and you must notify us of any changes to
          such personal information.</p>

        <p style="font-weight: 600">Information automatically collected</p>

        <p style="font-style: italic"><span style="font-weight: 600">In Short:</span> Some information — such as your
          Internet Protocol (IP) address and/or browser and device characteristics — is collected automatically when you
          visit our Services.</p>

        <p>We automatically collect certain information when you visit, use, or navigate the Services. This information
          does not reveal your
          specific identity (like your name or contact information) but may include device and usage
          information, such as your IP address, browser and device characteristics, operating system, language
          preferences, referring URLs, device name, country, location, information about how and when you use
          our Services, and other technical information. This information is primarily needed to maintain the
          security and operation of our Services, and for our internal analytics and reporting purposes.</p>

        <p>Like many businesses, we also collect information through cookies and similar technologies.</p>
        <p>The information we collect includes:</p>
        <ul>
          <li data-list-text="">
            <p><span style="font-style: italic">Log and Usage Data.</span>
              Log and usage data is service-related, diagnostic, usage, and performance information our servers
              automatically collect when you access or use our Services and which we record in log files. Depending on
              how you interact with us, this log data may include your IP address, device information, browser type, and
              settings and information about your activity in the Services (such as the date/time stamps associated with
              your usage, pages and files viewed, searches, and other actions you take such as which features you use),
              device event information (such as system activity, error reports (sometimes called &quot;crash dumps&quot;),
              and hardware settings).
            </p>
          </li>
          <li data-list-text="">
            <p><span style="font-style: italic">
            Device Data.</span> We collect device data such as information about your computer, phone, tablet, or other
              device you use to access the Services. Depending on the device used, this device data may include
              information such as your IP address (or proxy server), device and application identification numbers,
              location, browser type, hardware model, Internet service provider and/or mobile carrier, operating system,
              and system configuration information.
            </p>
          </li>
          <li data-list-text="">
            <p><span style="font-style: italic">Location Data.</span> We collect location data such as information about
              your device&#39;s location, which can be either precise or imprecise. How much information we collect
              depends on the type and settings of the device you use to access the Services. For example, we may use GPS
              and other technologies to collect geolocation data that tells us your current location (based on your IP
              address). You can opt out of allowing us to collect this information either by refusing access to the
              information or by disabling your Location setting on your device. However, if you choose to opt out, you
              may not be able to use certain aspects of the Services.
            </p>
          </li>
        </ul>
        <h2 id="information-processing">2. HOW DO WE PROCESS YOUR INFORMATION?</h2>
        <p style="font-style: italic"><span style="font-weight: 600"><br>In Short: </span>
          We process your information to provide, improve, and administer our Services, communicate with you, for
          security and fraud prevention, and to comply with law. We may also process your information for other purposes
          with your consent.
        </p>
        <p style="font-weight: 600">
          We process your personal information for a variety of reasons, depending on how you interact with our
          Services, including:
        </p>
        <div>
          <ul>
            <li data-list-text="">
              <p>
                <span style="font-weight: 600">To save or protect an individual&#39;s vital interest.</span> We may
                process your information when necessary to save or protect an individual’s vital interest, such as to
                prevent harm.
              </p>
            </li>
            <li data-list-text="">
              <p>
                <span style="font-weight: 600">Improving Services.</span> Error Log Collection
              </p>
            </li>
          </ul>
        </div>
        <h2 id="information-processing-legal">3. WHAT LEGAL BASES DO WE RELY ON TO PROCESS YOUR INFORMATION?</h2>
        <p style="font-style: italic"><br><span style="font-weight: 600">In Short:</span> We only process your personal
          information when we believe it is necessary and we have a valid legal reason (i.e., legal basis) to do so
          under applicable law, like with your consent, to comply with laws, to provide you with services to enter into
          or fulfill our contractual obligations, to protect your rights, or to fulfill our legitimate business
          interests.</p>


        <p style="font-weight: 600">If you are located in the EU or UK, this section applies to you.</p>

        <p>The General Data Protection Regulation
          (GDPR) and UK GDPR require us to explain the valid legal bases we rely on in order to process your
          personal information. As such, we may rely on the following legal bases to process your personal
          information:</p>

        <ul>
          <li data-list-text="">
            <p><span style="font-weight: 600">Consent.</span> We may process your information if you have given us
              permission (i.e.,
              consent) to use your personal information for a specific purpose. You can withdraw your consent at any
              time. Click <a href="#">here</a> to learn more.</p>
          </li>
          <li data-list-text="">
            <p><span style="font-weight: 600">Legitimate Interests.</span> We may process your information when we
              believe it is reasonably necessary to achieve our legitimate business interests and those interests do not
              outweigh your interests and fundamental rights and freedoms. For example, we may process your personal
              information for some of the purposes described in order to:</p>
            <ul>
              <li>
                <p>Diagnose problems and/or prevent fraudulent activities</p>
              </li>
            </ul>
          </li>
          <li data-list-text="">
            <p><span style="font-weight: 600">Legal Obligations.</span> We may process your information where we believe
              it is necessary for compliance with our legal obligations, such as to cooperate with a law enforcement
              body or regulatory agency, exercise or defend our legal rights, or disclose your information as evidence
              in litigation in which we are involved.</p>
          </li>
          <li data-list-text="">
            <p><span style="font-weight: 600">Vital Interests.</span> We may process your information where we believe
              it is necessary to protect your vital interests or the vital interests of a third party, such as
              situations involving potential threats to the safety of any person.</p>
          </li>
        </ul>
        <p style="font-weight: 600; text-decoration-line: underline;">If you are located in Canada, this section applies
          to you.</p>
        <p>We may process your information if you have given us specific
          permission (i.e., express consent) to use your personal information for a specific purpose, or in
          situations where your permission can be inferred (i.e., implied consent). You can withdraw your
          consent at any time. Click <a href="#review-update-delete">here</a> to learn more.</p>

        <p>In some exceptional cases, we may be legally permitted under applicable law to process your information
          without your consent, including, for example:</p>
        <ul>
          <li data-list-text="">
            <p>If collection is clearly in the interests of an individual and consent cannot be obtained in a timely
              way</p>
          </li>
          <li data-list-text="">
            <p>For investigations and fraud detection and prevention</p>
          </li>
          <li data-list-text="">
            <p>For business transactions provided certain conditions are met</p>
          </li>
          <li data-list-text="">
            <p>If it is contained in a witness statement and the collection is necessary to assess, process, or settle
              an insurance claim</p>
          </li>
          <li data-list-text="">
            <p>For identifying injured, ill, or deceased persons and communicating with next of kin</p>
          </li>
          <li data-list-text="">
            <p>If we have reasonable grounds to believe an individual has been, is, or may be victim of financial
              abuse</p>
          </li>
          <li data-list-text="">
            <p>If it is reasonable to expect collection and use with consent would compromise the availability or the
              accuracy of the information and the collection is reasonable for purposes related to investigating a
              breach of an agreement or a contravention of the laws of Canada or a province</p>
          </li>
          <li data-list-text="">
            <p>If disclosure is required to comply with a subpoena, warrant, court order, or rules of the court relating
              to the production of records</p>
          </li>
          <li data-list-text="">
            <p>If it was produced by an individual in the course of their employment, business, or profession and the
              collection is consistent with the purposes for which the information was produced</p>
          </li>
          <li data-list-text="">
            <p>If the collection is solely for journalistic, artistic, or literary purposes</p>
          </li>
          <li data-list-text="">
            <p>If the information is publicly available and is specified by the regulations</p>
          </li>
        </ul>
        <h2 id="personal-information-sharing">4. WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL INFORMATION?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> We may share information in specific situations described in
          this section and/or with the following third parties.
        </p>
        <p>We may need to share your personal information in the following situations:</p>
        <ul>
          <li data-list-text="">
            <p><span style="font-weight: 600">Business Transfers.</span> We may share or transfer your information in
              connection with, or during negotiations of, any merger, sale of company assets, financing, or acquisition
              of all or a portion of our business to another company.</p>
          </li>
        </ul>

        <h2 id="cookies-and-tracking">5. DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> We may use cookies and other tracking technologies to collect
          and store your information.
        </p>
        <p>We may use cookies and similar tracking technologies (like web beacons and pixels) to access or store
          information. Specific information about how we use such technologies and how you can refuse certain cookies is
          set out in our Cookie Notice.</p>

        <h2 id="keeping-information">6. HOW LONG DO WE KEEP YOUR INFORMATION?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> We keep your information for as long as necessary to fulfill
          the purposes outlined in this privacy notice unless otherwise required by law.
        </p>
        <p>We will only keep your personal information for as long as it is necessary for the purposes set out in this
          privacy notice, unless a longer retention period is required or permitted by law (such as tax, accounting, or
          other legal requirements). No purpose in this notice will require us keeping your personal information for
          longer than 2 years.</p>
        <p>When we have no ongoing legitimate business need to process your personal information, we will either delete
          or anonymize such information, or, if this is not possible (for example, because your personal information has
          been stored in backup archives), then we will securely store your personal information and isolate it from any
          further processing until deletion is possible.</p>

        <h2 id="information-safety">7. HOW DO WE KEEP YOUR INFORMATION SAFE?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> We aim to protect your personal information through a system
          of organizational and technical security measures.
        </p>
        <p>We have implemented appropriate and reasonable technical and organizational security measures designed to
          protect the security of any personal information we process. However, despite our safeguards and efforts to
          secure your information, no electronic transmission over the Internet or information storage technology can be
          guaranteed to be 100% secure, so we cannot promise or guarantee that hackers, cybercriminals, or other
          unauthorized third parties will not be able to defeat our security and improperly collect, access, steal, or
          modify your information. Although we will do our best to protect your personal information, transmission of
          personal information to and from our Services is at your own risk. You should only access the Services within
          a secure environment.</p>

        <h2 id="minors-information-collection">8. DO WE COLLECT INFORMATION FROM MINORS?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> We do not knowingly collect data from or market to children
          under 18 years of age.
        </p>
        <p>We do not knowingly solicit data from or market to children under 18 years of age. By using the Services, you
          represent that you are at least 18 or that you are the parent or guardian of such a minor and consent to such
          minor dependent’s use of the Services. If we learn that personal information from users less than 18 years of
          age has been collected, we will deactivate the account and take reasonable measures to promptly delete such
          data from our records. If you become aware of any data we may have collected from children under age 18,
          please contact us at <a href="mailto:support@gerowallet.io" target="_blank">support@gerowallet.io.</a></p>

        <h2 id="privacy-rights">9. WHAT ARE YOUR PRIVACY RIGHTS?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> In some regions, such as the European Economic Area (EEA),
          United Kingdom (UK), and Canada, you have rights that allow you greater access to and control over your
          personal information. You may review, change, or terminate your account at any time.
        </p>
        <p>In some regions (like the EEA, UK, and Canada), you have certain rights under applicable data protection
          laws. These may include the right (i) to request access and obtain a copy of your personal information, (ii)
          to request rectification or erasure; (iii) to restrict the processing of your personal information; and (iv)
          if applicable, to data portability. In certain circumstances, you may also have the right to object to the
          processing of your personal information. You can make such a request by contacting us by using the contact
          details provided in the section &quot;<a href="#notice-contact">HOW CAN YOU CONTACT US ABOUT THIS NOTICE?</a>&quot;
          below.</p>
        <p>We will consider and act upon any request in accordance with applicable data protection laws.</p>
        <p>If you are located in the EEA or UK and you believe we are unlawfully processing your
          personal information, you also have the right to complain to your local data protection supervisory
          authority. You can find their contact details <a
              href="https://ec.europa.eu/justice/data-protection/bodies/authorities/index_en.htm"
              target="_blank">here</a>.
        </p>
        <p>If you are located in Switzerland, the contact details for the data protection authorities are available <a
            href="https://www.edoeb.admin.ch/edoeb/en/home.html" target="_blank">here</a>.
        </p>
        <p>Withdrawing your consent: If we are relying on your consent to process your personal information, which may
          be express and/or implied consent depending on the applicable law, you have the right to withdraw your consent
          at any time. You can withdraw your consent at any time by contacting us by using the contact details provided
          in the section &quot;<a href="#notice-contact"> HOW CAN YOU CONTACT US ABOUT THIS NOTICE?</a>&quot; below.</p>
        <p>However, please note that this will not affect the lawfulness of the processing before its withdrawal, nor
          when applicable law allows, will it affect the processing of your personal information conducted in reliance
          on lawful processing grounds other than consent.</p>
        <p><span style="font-weight: 600">Cookies and similar technologies:</span> Most Web browsers are set to accept
          cookies by default. If you prefer, you can usually choose to set your browser to remove cookies and to reject
          cookies. If you choose to remove cookies or reject cookies, this could affect certain features or services of
          our Services. To opt out of interest-based advertising by advertisers on our Services visit <a
              href="http://www.aboutads.info/choices/" target="_blank">http://www.aboutads.info/choices/</a>.</p>
        <p>If you have questions or comments about your privacy rights, you may email us at <a
            href="mailto:support@gerowallet.io" target="_blank">support@gerowallet.io.</a></p>

        <h2 id="do-not-track">10. CONTROLS FOR DO-NOT-TRACK FEATURES</h2>
        <p>Most web browsers and some mobile operating systems and mobile applications include a Do-Not-Track (&quot;DNT&quot;)
          feature or setting you can activate to signal your privacy preference not to have data about your online
          browsing activities monitored and collected. At this stage no uniform technology standard for recognizing and
          implementing DNT signals has been finalized. As such, we do not currently respond to DNT browser signals or
          any other mechanism that automatically communicates your choice not to be tracked online. If a standard for
          online tracking is adopted that we must follow in the future, we will inform you about that practice in a
          revised version of this privacy notice.</p>

        <h2 id="california-privacy">11. CALIFORNIA RESIDENTS HAVE SPECIFIC PRIVACY RIGHTS?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> Yes, if you are a resident of California, you are granted
          specific rights regarding access to your personal information.
        </p>
        <p>California Civil Code Section 1798.83, also known as the &quot;Shine The Light&quot; law, permits our users
          who are California residents to request and obtain from us, once a year and free of charge, information about
          categories of personal information (if any) we disclosed to third parties for direct marketing purposes and
          the names and addresses of all third parties with which we shared personal information in the immediately
          preceding calendar year. If you are a California resident and would like to make such a request, please submit
          your request in writing to us using the contact information provided below.</p>
        <p>If you are under 18 years of age, reside in California, and have a registered account with Services, you have
          the right to request removal of unwanted data that you publicly post on the Services. To request removal of
          such data, please contact us using the contact information provided below and include the email address
          associated with your account and a statement that you reside in California. We will make sure the data is not
          publicly displayed on the Services, but please be aware that the data may not be completely or comprehensively
          removed from all our systems (e.g., backups, etc.).</p>
        <p style="font-weight: 600">CCPA Privacy Notice</p>
        <p>The California Code of Regulations defines a &quot;resident&quot; as:</p>
        <ol>
          <li data-list-text="(1)"><p>every individual who is in the State of California for other than a temporary or
            transitory purpose and</p></li>
          <li data-list-text="(2)"><p>every individual who is domiciled in the State of California who is outside the
            State of California for a temporary or transitory purpose</p></li>
        </ol>
        <p>All other individuals are defined as &quot;non-residents&quot;.</p>
        <p>If this definition of &quot;resident&quot; applies to you, we must adhere to certain rights and obligations
          regarding your personal information.</p>
        <p style="font-weight: 600">What categories of personal information do we collect?</p>
        <p>We have collected the following categories of personal information in the past twelve (12) months:</p>

        <table style="border-collapse:collapse;">
          <tr style="height:30pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s14" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">Category</p>
            </td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s14" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">Examples</p>
            </td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s14"
                 style="padding-top: 7pt;padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">
                Collected</p>
            </td>
          </tr>
          <tr style="height:56pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">A. Identifiers</p>
            </td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">Contact details, such as real
                name, alias, postal address, telephone or mobile contact number, unique personal identifier, online
                identifier, Internet Protocol address, email address, and account name</p>
            </td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15"
                 style="padding-left: 77pt;padding-right: 75pt;text-indent: 0;text-align: center;">YES</p>
            </td>
          </tr>
          <tr style="height:43pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">B.
                Personal information categories listed in the California Customer Records statute</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;padding-right: 3pt;text-indent: 0;text-align: left;">
                Name, contact information, education, employment, employment history, and financial
                information</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:31pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">C. Protected
                classification characteristics under California or federal law</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">
                Gender and date of birth</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:30pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">D.
                Commercial information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">Transaction
                information, purchase history, financial details, and payment information</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:31pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">E.
                Biometric information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">
                Fingerprints and voiceprints</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:43pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15"
                 style="padding-top: 7pt;padding-left: 6pt;padding-right: 4pt;text-indent: 0;text-align: left;">
                F. Internet or other similar network activity</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">Browsing history,
                search history, online behavior, interest data, and interactions with our and other websites,
                applications, systems, and advertisements</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:30pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">G.
                Geolocation data</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">
                Device location</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:31pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">H. Audio,
                electronic,
                visual, thermal, olfactory, or similar information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;padding-right: 3pt;text-indent: 0;text-align: left;">
                Images and audio, video or call recordings created in connection with our business
                activities</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:56pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">I. Professional or
                employment-related information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;padding-right: 2pt;text-indent: 0;text-align: left;">
                Business contact details in order to provide you our services at a business level or job
                title,
                work history, and professional qualifications if you apply for a job with us</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:30pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">J.
                Education Information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-top: 7pt;padding-left: 6pt;text-indent: 0;text-align: left;">
                Student records and directory information</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
          <tr style="height:55pt">
            <td style="width:199pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15" style="padding-left: 6pt;text-indent: 0;text-align: left;">K. Inferences drawn
                from other personal information</p></td>
            <td style="width:243pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">
              <p class="s15" style="padding-left: 6pt;padding-right: 1pt;text-indent: 0;text-align: left;">Inferences
                drawn from any of the collected personal information listed above to create a profile or summary about,
                for example, an individual’s preferences and characteristics</p></td>
            <td style="width:202pt;border-top-style:solid;border-top-width:1pt;border-left-style:solid;border-left-width:1pt;border-bottom-style:solid;border-bottom-width:1pt;border-right-style:solid;border-right-width:1pt">

              <p class="s15"
                 style="padding-left: 78pt;padding-right: 75pt;text-indent: 0;text-align: center;">NO</p>
            </td>
          </tr>
        </table>

        <p>We may also collect other personal information outside of these categories instances where you interact with
          us in person, online, or by phone or mail in the context of:</p>
        <ul>
          <li data-list-text="">
            <p>Receiving help through our customer support channels;</p>
          </li>
          <li data-list-text="">
            <p>Participation in customer surveys or contests; and</p>
          </li>
          <li data-list-text="">
            <p>Facilitation in the delivery of our Services and to respond to your inquiries.</p>
          </li>
        </ul>
        <p style="font-weight: 600">How do we use and share your personal information?</p>
        <p>More information about our data collection and sharing practices can be found in this privacy notice.</p>
        <p>You may contact us by email at <a href="mailto:support@gerowallet.io"
                                             target="_blank">support@gerowallet.io</a>
          , or by referring to the contact details at the bottom of this document.</p>
        <p>If you are using an authorized agent to exercise your right to opt out we may deny a request if the
          authorized agent does not submit proof that they have been validly authorized to act on your behalf.</p>
        <p style="font-weight: 600">Will your information be shared with anyone else?</p>
        <p>We may disclose your personal information with our service providers pursuant to a written contract between
          us and each service provider. Each service provider is a for-profit entity that processes the information on
          our behalf.</p>
        <p>We may use your personal information for our own business purposes, such as for undertaking internal research
          for technological development and demonstration. This is not considered to be &quot;selling&quot; of your
          personal information.</p>
        <p>Gero Labs Inc. has not disclosed or sold any personal information to third parties for a business or
          commercial purpose in the preceding twelve (12) months. Gero Labs Inc. will not sell personal information in
          the future belonging to website visitors, users, and other consumers.</p>
        <p style="font-weight: 600">Your rights with respect to your personal data</p>
        <p style="font-weight: 600; text-decoration: underline">Right to request deletion of the data — Request to
          delete</p>
        <p>You can ask for the deletion of your personal information. If you ask us to delete your personal information,
          we will respect your request and delete your personal information, subject to certain exceptions provided by
          law, such as (but not limited to) the exercise by another consumer of his or her right to free speech, our
          compliance requirements resulting from a legal obligation, or any processing that may be required to protect
          against illegal activities.</p>
        <p style="font-weight: 600; text-decoration: underline">Right to be informed — Request to know</p>
        <p>Depending on the circumstances, you have a right to know:</p>
        <ul>
          <li data-list-text="">
            <p>whether we collect and use your personal information;</p>
          </li>
          <li data-list-text="">
            <p>the categories of personal information that we collect;</p>
          </li>
          <li data-list-text="">
            <p>the purposes for which the collected personal information is used;</p>
          </li>
          <li data-list-text="">
            <p>whether we sell your personal information to third parties;</p>
          </li>
          <li data-list-text="">
            <p>the categories of personal information that we sold or disclosed for a business purpose;</p>
          </li>
          <li data-list-text="">
            <p>the categories of third parties to whom the personal information was sold or disclosed for a business
              purpose; and</p>
          </li>
          <li data-list-text="">
            <p>the business or commercial purpose for collecting or selling personal information.</p>
          </li>
        </ul>
        <p>In accordance with applicable law, we are not obligated to provide or delete consumer information that is
          de-identified in response to a consumer request or to re-identify individual data to verify a consumer
          request.</p>
        <p style="font-weight: 600; text-decoration: underline">Right to Non-Discrimination for the Exercise of a
          Consumer’s Privacy Rights</p>
        <p>We will not discriminate against you if you exercise your privacy rights.</p>
        <p style="font-weight: 600; text-decoration: underline">Verification process</p>
        <p>Upon receiving your request, we will need to verify your identity to determine you are the same person about
          whom we have the information in our system. These verification efforts require us to ask you to provide
          information so that we can match it with information you have previously provided us. For instance, depending
          on the type of request you submit, we may ask you to provide certain information so that we can match the
          information you provide with the information we already have on file, or we may contact you through a
          communication method (e.g., phone or email) that you have previously provided to us. We may also use other
          verification methods as the circumstances dictate.</p>
        <p>We will only use personal information provided in your request to verify your identity or authority to make
          the request. To the extent possible, we will avoid requesting additional information from you for the purposes
          of verification. However, if we cannot verify your identity from the information already maintained by us, we
          may request that you provide additional information for the purposes of verifying your identity and for
          security or fraud-prevention purposes. We will delete such additionally provided information as soon as we
          finish verifying you.</p>
        <p style="text-decoration: underline">Other privacy rights</p>
        <ul>
          <li data-list-text="">
            <p>You may object to the processing of your personal information.</p>
          </li>
          <li data-list-text="">
            <p>You may request correction of your personal data if it is incorrect or no longer relevant, or ask to
              restrict the processing of the information.</p>
          </li>
          <li data-list-text="">
            <p>You can designate an authorized agent to make a request under the CCPA on your behalf. We may deny a
              request from an authorized agent that does not submit proof that they have been validly authorized to act
              on your behalf in accordance with the CCPA.</p>
          </li>
          <li data-list-text="">
            <p>You may request to opt out from future selling of your personal information to third parties. Upon
              receiving an opt-out request, we will act upon the request as soon as feasibly possible, but no later than
              fifteen (15) days from the date of the request submission.</p></li>
        </ul>
        <p>To exercise these rights, you can contact us by email at <a href="mailto:support@gerowallet.io"
                                                                       target="_blank">support@gerowallet.io</a>, or by
          referring to the contact details at the bottom of this document. If you have a complaint about how we handle
          your data, we would like to hear from you.</p>

        <h2 id="update-notice">12. DO WE MAKE UPDATES TO THIS NOTICE?</h2>
        <p style="font-style: italic"><br>
          <span style="font-weight: 600">In Short:</span> Yes, we will update this notice as necessary to stay compliant
          with relevant laws.
        </p>
        <p>We may update this privacy notice from time to time. The updated version will be indicated by an updated
          &quot;Revised&quot; date and the updated version will be effective as soon as it is accessible. If we make
          material changes to this privacy notice, we may notify you either by prominently posting a notice of such
          changes or by directly sending you a notification. We encourage you to review this privacy notice frequently
          to be informed of how we are protecting your information.</p>

        <h2 id="notice-contact">13. HOW CAN YOU CONTACT US ABOUT THIS NOTICE?</h2>
        <p>If you have questions or comments about this notice, you may email us at <a
            href="mailto:support@gerowallet.io" target="_blank">support@gerowallet.io</a> or by post to:</p>
        <p>Gero Labs Inc.</p>
        <p>Trinity Chambers PO Box 4301</p>
        <p>Road Town, Tortola 4301 British Virgin Islands</p>

        <h2 id="review-update-delete">14. HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?</h2>
        <p>Based on the applicable laws of your country, you may have the right to request access to the personal
          information we collect from you, change that information, or delete it in some circumstances. To request to
          review, update, or delete your personal information, please submit a request by email at <a
              href="mailto:support@gerowallet.io" target="_blank">support@gerowallet.io</a></p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
<script>
export default {
  name: "PrivacyPolicyDialog",
  props: {
    dialog: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        this.$emit('dialogChange', value)
      },
    },
  },
  data: () => ({})
}
</script>
<style scoped>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}
</style>