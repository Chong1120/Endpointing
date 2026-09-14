# Generates the synthetic SafeCall demo recordings with Windows' built-in
# System.Speech voices. Every name, number, address and card below is FAKE
# (555-01xx phone numbers, example.com emails, the standard 4111... test card).
#
# Usage (Windows PowerShell):  ./generate-samples.ps1
# Output: 16 kHz, 16-bit, mono WAV files next to this script.

Add-Type -AssemblyName System.Speech

$AgentVoice = 'Microsoft David Desktop'
$CustomerVoice = 'Microsoft Zira Desktop'

$calls = [ordered]@{
  'call-a-account-update.wav' = @(
    @('A', 'Thank you for calling Northwind Mobile, my name is Daniel. How can I help you today?'),
    @('C', 'Hi Daniel. I just moved, and I need to update my account details. My name is Sarah Mitchell.'),
    @('A', 'Welcome, Sarah. I can help with that. First, can you confirm the phone number on the account?'),
    @('C', 'Sure. It is four one five, five five five, zero one nine eight.'),
    @('A', 'Thank you. And what is the best email address for your account?'),
    @('C', 'It is sarah dot mitchell at example dot com.'),
    @('A', 'Got it. What is your new home address?'),
    @('C', 'Twelve forty two Maple Avenue, apartment three B, Portland, Oregon, nine seven two zero one.'),
    @('A', 'Perfect, the address is updated. Would you also like to update the card used for automatic payments?'),
    @('C', 'Yes please. The new card number is four one one one, one one one one, one one one one, one one one one. It expires oh nine, twenty eight, and the security code is one two three.'),
    @('A', 'Thank you, Sarah. Your new card is saved and autopay is active. Is there anything else I can help you with?'),
    @('C', 'No, that is everything. Thanks so much, Daniel.'),
    @('A', 'You are welcome. Have a great day.')
  )
  'call-b-tech-support.wav' = @(
    @('A', 'Northwind Internet technical support, this is Alex. What seems to be the problem?'),
    @('C', 'Hi Alex. My internet keeps dropping every few minutes since yesterday evening.'),
    @('A', 'I am sorry to hear that. Can I get your account number so I can pull up your service?'),
    @('C', 'Yes, it is account number seven seven four, two nine one, five five zero.'),
    @('A', 'Thanks. I can see your modem. Are the lights on the front solid or blinking?'),
    @('C', 'The internet light is blinking orange.'),
    @('A', 'Okay. That usually means the modem lost its connection to our network. Could you unplug the power cable, wait thirty seconds, and plug it back in?'),
    @('C', 'Sure, give me a moment. Okay, it is restarting now.'),
    @('A', 'Great. While it restarts, I am running a line test from our side. I do see some signal noise on your line.'),
    @('C', 'Is that something I did?'),
    @('A', 'Not at all. It is most likely a loose connection outside. I am going to schedule a technician to check the line.'),
    @('C', 'The light is solid green now, and the internet is back.'),
    @('A', 'Excellent. I will still send a technician on Thursday morning to fix the signal noise so it does not happen again.'),
    @('C', 'That works for me. Thank you for your help.'),
    @('A', 'My pleasure. You will get a confirmation text shortly.')
  )
  'call-c-general-inquiry.wav' = @(
    @('A', 'Thanks for calling Northwind support. How can I help you today?'),
    @('C', 'Hi, I have a quick question. How do I switch to paperless billing?'),
    @('A', 'Happy to explain. In the mobile app, open settings, then billing, and turn on the paperless option.'),
    @('C', 'Does it cost anything?'),
    @('A', 'No, paperless billing is free, and you will get a notification each month when your statement is ready.'),
    @('C', 'Great. And can I still download older statements?'),
    @('A', 'Yes. Your previous statements stay available in the billing section of the app.'),
    @('C', 'Perfect, that is all I needed. Thank you.'),
    @('A', 'You are welcome. Have a nice day.')
  )
  'call-d-billing-refund.wav' = @(
    @('A', 'Northwind billing department, this is Michael speaking. How can I help?'),
    @('C', 'Hi Michael. I was charged twice for my subscription this month and I would like a refund.'),
    @('A', 'I am sorry about that. I will look into it right away. May I have your full name and date of birth to verify the account?'),
    @('C', 'It is Emily Carter, and my date of birth is March fourteenth, nineteen eighty seven.'),
    @('A', 'Thank you, Emily. And the account number, please?'),
    @('C', 'It is eight eight three, four six two, one zero nine.'),
    @('A', 'I see two charges of forty nine ninety nine on the second of this month. The second one is a duplicate caused by a payment retry.'),
    @('C', 'That is frustrating. I really need that money back.'),
    @('A', 'Completely understandable. I have issued a refund for the duplicate charge. It will go back to your card within five to seven business days.'),
    @('C', 'Okay. Will I get a confirmation?'),
    @('A', 'Yes, I will send a confirmation to the email on file. Can you confirm it is emily dot carter at example dot com?'),
    @('C', 'Yes, that is correct.'),
    @('A', 'Great. I have also added a note to prevent duplicate retries on your account. Is there anything else?'),
    @('C', 'No, thank you. I appreciate you fixing this so quickly.')
  )
}

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($file in $calls.Keys) {
  $builder = New-Object System.Speech.Synthesis.PromptBuilder
  $builder.AppendBreak([TimeSpan]::FromMilliseconds(400))
  foreach ($line in $calls[$file]) {
    $voice = if ($line[0] -eq 'A') { $AgentVoice } else { $CustomerVoice }
    $builder.StartVoice($voice)
    $builder.AppendText($line[1])
    $builder.EndVoice()
    $builder.AppendBreak([TimeSpan]::FromMilliseconds(550))
  }

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = 0
  $out = Join-Path $PSScriptRoot $file
  $synth.SetOutputToWaveFile($out, $format)
  $synth.Speak($builder)
  $synth.Dispose()
  $size = [math]::Round((Get-Item $out).Length / 1KB)
  Write-Output "Wrote $file ($size KB)"
}
