/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 * Abilities will have a base turn of 2, modified based on corresponding STATS
 * if STR gets greater than x value, player is able to apply force conditions as
 * well
 */
public class Condition {

    public String name;
    int maxTurns, tempTurns; //COULD ROLL A DICE INSTEAD OF SETTING FIXED TURNS, ALSO, ADD +1 TO AVOID BEING MIN 2
    public String conditionText;

    // PHYSICAL (CON helps you resist them once affected needs to wait or external help, STR cause them)
    public static Condition bleed = new Condition("Bleed", 2);
    public static Condition stun = new Condition("Stun", 2); //OK
    public static Condition fracture = new Condition("Fracture", 100); //OK Needs rest to go away, gives disadvantage
    public static Condition regeneration = new Condition("Regeneration", 2); //OK

    // BASIC ELEMENTAL (CON chance of breaking, INT cause)
    public static Condition burn = new Condition("Burn", 2); //OK dmg per turn
    public static Condition freeze = new Condition("Freeze", 2); //OK like stun but chance of breaking based on strength
    public static Condition electrify = new Condition("Electrify", 2); //OK chance of dealing damage + lose turn
    public static Condition poison = new Condition("Poison", 2); //needs antidote to heal

    // PSYCHIC (WIS resist/cause)
    public static Condition sleep = new Condition("Sleep", 2);
    public static Condition insanity = new Condition("Insanity", 2); //random things may happen, random attacks, skills

    // FORCE (WIS)
    public static Condition push = new Condition("Push", 1); // if pushed hard enough, can stun
    public static Condition aired = new Condition("Aired", 2); // it's a stun with a damage on last turn, +DMG the +WIS

    // STATS AUGMENTATION WILL BE DONE AFTER RELEASE
    public static Condition strong = new Condition("Strong", 2);
    public static Condition quick = new Condition("Agile", 2);
    public static Condition healthy = new Condition("Healthy", 2);
    public static Condition smart = new Condition("Brainy", 2);
    public static Condition wise = new Condition("Wise", 2);
    public static Condition charming = new Condition("Charming", 2);

    // STATS DEPRIVATION (the augmentation will be caused by substances, these are like withdrawals. Can get worse by time, can be healed always)
    public static Condition weak = new Condition("Weak", 2);
    public static Condition slow = new Condition("Slow", 2);
    public static Condition sick = new Condition("Sick", 2);
    public static Condition dumb = new Condition("Dumb", 2);
    public static Condition fool = new Condition("Fool", 2);
    public static Condition repulsive = new Condition("Repulsive", 2);

    public Condition(String name, int maxTurns) {
        this.name = name;
        this.maxTurns = maxTurns;
        this.tempTurns = maxTurns;
    }

    public static void tickConditions() {
        int damage;

        //CHAIN FOR PLAYER, MUST DO ONE FOR ENEMY
        if (!Player.activeConditions.isEmpty()) {
            int savingThrow = 0;
            for (Condition i : Player.activeConditions) {
                if (i.equals(null)) {//<editor-fold defaultstate="collapsed" desc="condition empty template">

                }
                //</editor-fold>
                if (i.equals(burn)) {//<editor-fold defaultstate="collapsed" desc="Burn">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You caught on fire!");
                        i.tempTurns--;
                    } else if (i.tempTurns > 0) {
                        damage = 1;
                        GameLogic.player.hp -= damage;
                        System.out.println("You took " + damage + " damage from burning.");
                        i.tempTurns--;

                        if (savingThrow >= Enemy.staticStats[3]) {
                            System.out.println("You roll on the floor and manage to put the fire out.");
                            i.tempTurns = i.maxTurns;
                            Player.activeConditions.remove(i);
                            break;
                        }

                    } else {
                        System.out.println("You are no longer burning!");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                if (i.equals(freeze)) {//<editor-fold defaultstate="collapsed" desc="Freeze">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You slowly feel yourself unable to move.");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;
                    } else if (i.tempTurns > 0) {
                        System.out.println("You can see what is in front of you, but you are unable to move.");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;

                        if (savingThrow >= Enemy.staticStats[3]) {
                            System.out.println("You brutely break from the ice that covered you!");
                            i.tempTurns = i.maxTurns;
                            Player.activeConditions.remove(i);
                            break;
                        }

                    } else {
                        System.out.println("The ice arround you quickly melts away...");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                if (i.equals(electrify)) {//<editor-fold defaultstate="collapsed" desc="Electrify">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("An unnatural surge of electricity runs through your body.");
                        i.tempTurns--;
                    } else if (i.tempTurns > 0) {
                        System.out.println("Unnatural electricity still runs through your body.");
                        i.tempTurns--;
                        if (savingThrow < Enemy.staticStats[3]) {
                            damage = 1;
                            GameLogic.player.hp -= damage;
                            System.out.println("Tzzz.\nYou take " + damage + " damage and lose your turn.");
                            GameLogic.isPlayerSkipTurn = true;
                            break;
                        }

                    } else {
                        System.out.println("The electricty flows from your body to the ground and you're ready to go.");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>

                // need to add poison here
                if (i.equals(stun)) {//<editor-fold defaultstate="collapsed" desc="Stun">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("K.O.! You are knocked out!");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;
                    } else if (i.tempTurns > 0) {
                        System.out.println("You are knocked out.");
                        i.tempTurns--;
                        GameLogic.isPlayerSkipTurn = true;

                    } else {
                        System.out.println("You regain consciousness and are ready to fight!");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                if (i.equals(regeneration)) {//<editor-fold defaultstate="collapsed" desc="Regeneration">
                    savingThrow += Dice.rollDice(Dice.d20) + Player.staticStatsMods[0];
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You feel grace flowing through your system.");
                        damage = 2;
                        GameLogic.player.hp += damage;
                        System.out.println("You heal for " + damage + " health.");
                        i.tempTurns--;
                    } else if (i.tempTurns > 0) {
                        System.out.println("You are healing.");
                        damage = 1;
                        GameLogic.player.hp += damage;
                        System.out.println("You heal for " + damage + " health.");
                        i.tempTurns--;
                    } else {
                        System.out.println("The temporary bliss fades away. Back to rumbling on your own terms!");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                if (i.equals(fracture)) {//<editor-fold defaultstate="collapsed" desc="Fracture">
                    if (i.tempTurns == i.maxTurns) {
                        System.out.println("You scream as your hear your bone cracking");
                        i.tempTurns--;
                        GameLogic.player.advantageDisadvantage = -1;
                    } else if (i.tempTurns > 0) {
                        System.out.println("Your bone is broken.");
                        i.tempTurns--;
                        GameLogic.player.advantageDisadvantage = -1;
                    } else {
                        System.out.println("Your bone was not supposed to heal, but hey, it's a feature!");
                        i.tempTurns = i.maxTurns;
                        Player.activeConditions.remove(i);
                        break;
                    }
                }
                //</editor-fold>
                
                
            }
        } //END OF PLAYER CHAIN
        //do an if chain (just ifs) for each condition
    }
}
